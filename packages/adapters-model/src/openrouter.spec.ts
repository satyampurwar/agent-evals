import { describe, expect, it } from 'vitest';
import { OpenRouterAdapter, parseToolArguments, toWireMessage } from './openrouter';
import { createModelAdapter, parseModelSpec } from './registry';

type Captured = { url: string; body: Record<string, unknown>; headers: Headers };

function fakeFetch(reply: unknown, status = 200) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify(reply), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

const okReply = (message: Record<string, unknown>, usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }) => ({
  id: 'gen-1',
  object: 'chat.completion',
  created: 0,
  model: 'openai/gpt-4.1-mini',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', ...message } }],
  usage,
});

describe('OpenRouterAdapter request mapping', () => {
  it('sends an OpenAI-compatible request to the OpenRouter base URL', async () => {
    const { fetchImpl, calls } = fakeFetch(okReply({ content: '42' }));
    const adapter = new OpenRouterAdapter({ apiKey: 'test-key', fetch: fetchImpl, maxRetries: 0 });

    await adapter.complete('openai/gpt-4.1-mini', {
      messages: [{ role: 'user', content: 'What is 17 + 25?' }],
      temperature: 0,
      maxTokens: 16,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].headers.get('authorization')).toBe('Bearer test-key');
    expect(calls[0].body).toMatchObject({
      model: 'openai/gpt-4.1-mini',
      messages: [{ role: 'user', content: 'What is 17 + 25?' }],
      temperature: 0,
      max_tokens: 16,
    });
    expect(calls[0].body).not.toHaveProperty('tools');
  });

  it('sends tool specs in function-tool format when tools are given', async () => {
    const { fetchImpl, calls } = fakeFetch(okReply({ content: 'x' }));
    const adapter = new OpenRouterAdapter({ apiKey: 'k', fetch: fetchImpl, maxRetries: 0 });
    await adapter.complete('m', {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } }],
      temperature: 0,
      maxTokens: 8,
    });
    expect(calls[0].body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } },
      },
    ]);
  });
});

describe('OpenRouterAdapter response parsing', () => {
  it('returns content and token usage', async () => {
    const { fetchImpl } = fakeFetch(okReply({ content: '42' }));
    const adapter = new OpenRouterAdapter({ apiKey: 'k', fetch: fetchImpl, maxRetries: 0 });
    const res = await adapter.complete('m', { messages: [{ role: 'user', content: 'q' }], temperature: 0, maxTokens: 8 });
    expect(res.message).toEqual({ role: 'assistant', content: '42', toolCalls: undefined });
    expect(res.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });

  it('parses tool calls into ToolCall objects with object arguments', async () => {
    const { fetchImpl } = fakeFetch(
      okReply({
        content: null,
        tool_calls: [
          {
            id: 'call_9',
            type: 'function',
            function: { name: 'write_file', arguments: '{"path":"answer.txt","content":"ok"}' },
          },
        ],
      }),
    );
    const adapter = new OpenRouterAdapter({ apiKey: 'k', fetch: fetchImpl, maxRetries: 0 });
    const res = await adapter.complete('m', { messages: [{ role: 'user', content: 'q' }], temperature: 0, maxTokens: 8 });
    expect(res.message.content).toBe('');
    expect(res.message.toolCalls).toEqual([
      { id: 'call_9', name: 'write_file', arguments: { path: 'answer.txt', content: 'ok' } },
    ]);
  });

  it('propagates HTTP errors', async () => {
    const { fetchImpl } = fakeFetch({ error: { message: 'bad key' } }, 401);
    const adapter = new OpenRouterAdapter({ apiKey: 'k', fetch: fetchImpl, maxRetries: 0 });
    await expect(
      adapter.complete('m', { messages: [{ role: 'user', content: 'q' }], temperature: 0, maxTokens: 8 }),
    ).rejects.toThrow();
  });

  it('refuses to construct without an API key', () => {
    expect(() => new OpenRouterAdapter({ apiKey: '' })).toThrow(/OPENROUTER_API_KEY/);
  });
});

describe('message and argument helpers', () => {
  it('maps an assistant tool-call turn and its tool result', () => {
    expect(
      toWireMessage({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.txt' } }],
      }),
    ).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
    });
    expect(toWireMessage({ role: 'tool', content: '{"ok":true}', toolCallId: 'c1' })).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"ok":true}',
    });
  });

  it('rejects a tool message without toolCallId', () => {
    expect(() => toWireMessage({ role: 'tool', content: 'x' })).toThrow(/toolCallId/);
  });

  it('keeps invalid JSON arguments visible instead of dropping them', () => {
    expect(parseToolArguments('{"path":')).toEqual({ __invalid_json: '{"path":' });
    expect(parseToolArguments('[1,2]')).toEqual({ __invalid_json: '[1,2]' });
    expect(parseToolArguments('{"path":"x"}')).toEqual({ path: 'x' });
  });
});

describe('model registry', () => {
  it('parses provider:modelId, keeping slashes in the model id', () => {
    expect(parseModelSpec('openrouter:openai/gpt-4.1-mini')).toEqual({
      provider: 'openrouter',
      modelId: 'openai/gpt-4.1-mini',
    });
  });

  it('rejects malformed specs', () => {
    expect(() => parseModelSpec('openrouter')).toThrow(/provider:modelId/);
    expect(() => parseModelSpec('openrouter:')).toThrow(/provider:modelId/);
    expect(() => parseModelSpec(':x')).toThrow(/provider:modelId/);
  });

  it('builds the openrouter adapter from env, and fails clearly without a key', () => {
    expect(createModelAdapter('openrouter', { OPENROUTER_API_KEY: 'k' }).id).toBe('openrouter');
    expect(() => createModelAdapter('openrouter', {})).toThrow(/OPENROUTER_API_KEY/);
  });

  it('builds the mock adapter and rejects unknown providers', () => {
    expect(createModelAdapter('mock', {}).id).toBe('mock');
    expect(() => createModelAdapter('nope', {})).toThrow(/unknown model provider/);
  });
});
