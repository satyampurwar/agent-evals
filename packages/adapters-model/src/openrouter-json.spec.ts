import { describe, expect, it } from 'vitest';
import { OpenRouterAdapter } from './openrouter';

function jsonReply() {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        id: 'gen-1',
        object: 'chat.completion',
        created: 0,
        model: 'm',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

describe('OpenRouterAdapter responseFormat', () => {
  it('sends response_format json_object when the request asks for JSON', async () => {
    const { fetchImpl, calls } = jsonReply();
    const adapter = new OpenRouterAdapter({ apiKey: 'k', fetch: fetchImpl, maxRetries: 0 });
    await adapter.complete('m', {
      messages: [{ role: 'user', content: 'grade this' }],
      temperature: 0,
      maxTokens: 100,
      responseFormat: 'json',
    });
    expect(calls[0]).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('does not send response_format by default', async () => {
    const { fetchImpl, calls } = jsonReply();
    const adapter = new OpenRouterAdapter({ apiKey: 'k', fetch: fetchImpl, maxRetries: 0 });
    await adapter.complete('m', { messages: [{ role: 'user', content: 'hi' }], temperature: 0, maxTokens: 10 });
    expect(calls[0]).not.toHaveProperty('response_format');
  });
});
