import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { TaskSchema } from '@agent-evals/domain';
import type { TraceEvent } from '@agent-evals/domain';
import { MockModelAdapter } from '@agent-evals/adapters-model';
import { ClaudeAgentHarness } from './claude-agent';
import type { ClaudeAgentQuery } from './claude-agent';
import { createTrialMemory } from './memory';
import type { HarnessRunInput } from './types';

// The tests never start Claude Code: `query` is replaced by a fake that streams canned SDK messages.

const MODEL = 'anthropic/claude-haiku-4.5';
const task = TaskSchema.parse({
  id: 'write_answer',
  version: '1.0.0',
  name: 'Write answer',
  description: 'd',
  prompt: 'Create answer.txt containing ok.',
  graders: [],
  tags: [],
});

let sandboxDir: string;

beforeEach(async () => {
  sandboxDir = await mkdtemp(join(tmpdir(), 'claude-agent-spec-'));
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(sandboxDir, { recursive: true, force: true });
});

function runInput(
  events: TraceEvent[],
  overrides: { toolIds?: string[]; budgets?: Partial<HarnessRunInput['context']['budgets']> } = {},
): HarnessRunInput {
  return {
    task,
    model: new MockModelAdapter('unused'),
    modelId: MODEL,
    modelParams: { temperature: 0 },
    context: {
      trialId: 'trial-1',
      seed: 1,
      sandboxDir,
      budgets: { maxSteps: 4, maxTokens: 1000, timeoutMs: 5000, ...overrides.budgets },
      memory: createTrialMemory({ client_id: 'HL-2044' }),
      skillIds: [],
      toolIds: overrides.toolIds ?? ['write_file', 'memory_read'],
      emit: (event) => events.push(event),
    },
  };
}

// ---- Fake SDK messages (only the fields the harness reads) ----

const usage = (input: number, output: number, cacheCreation = 0, cacheRead = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheCreation,
  cache_read_input_tokens: cacheRead,
});

const assistant = (id: string, content: unknown[], u = usage(10, 5)) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, content, usage: u },
});
const text = (value: string) => ({ type: 'text', text: value });
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'tool_use',
  id,
  name: `mcp__evals__${name}`,
  input,
});
const toolResult = (id: string, payload: unknown, isError = false) => ({
  type: 'tool_result',
  tool_use_id: id,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  is_error: isError,
});
const userResults = (...blocks: unknown[]) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: blocks },
});
const success = (result: string, u = usage(30, 10)) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result,
  num_turns: 2,
  usage: u,
});

interface Captured {
  prompt?: string;
  options?: Options;
}

/** A fake `query()` that replays `messages` and records what the harness passed in. */
function fakeQuery(messages: unknown[], captured: Captured = {}): ClaudeAgentQuery {
  return (params) => {
    captured.prompt = params.prompt;
    captured.options = params.options;
    return (async function* () {
      for (const message of messages) yield message as SDKMessage;
    })();
  };
}

const run = (input: HarnessRunInput, query: ClaudeAgentQuery) => new ClaudeAgentHarness({ query }).run(input);
const types = (events: TraceEvent[]) => events.map((e) => e.type);

describe('ClaudeAgentHarness trace and output', () => {
  it('turns a tool-using run into trace events and a HarnessRunOutput', async () => {
    const events: TraceEvent[] = [];
    const captured: Captured = {};
    const out = await run(
      runInput(events),
      fakeQuery(
        [
          // The SDK sends one message per content block; both belong to the same model call.
          assistant('m1', [text('writing')]),
          assistant('m1', [toolUse('c1', 'write_file', { path: 'answer.txt', content: 'ok' })]),
          userResults(toolResult('c1', { path: 'answer.txt', bytes: 2 })),
          assistant('m2', [text('done')]),
          success('done'),
        ],
        captured,
      ),
    );

    expect(captured.prompt).toBe(task.prompt);
    expect(out).toEqual({
      finalAnswer: 'done',
      stoppedReason: 'completed',
      usage: { promptTokens: 30, completionTokens: 10 },
      stepCount: 2,
    });
    expect(events).toEqual([
      { ts: expect.any(String), type: 'step_boundary', step: 1 },
      { ts: expect.any(String), type: 'message', role: 'user', content: task.prompt },
      { ts: expect.any(String), type: 'message', role: 'assistant', content: 'writing' },
      {
        ts: expect.any(String),
        type: 'tool_call',
        name: 'write_file',
        args: { path: 'answer.txt', content: 'ok' },
        callId: 'c1',
      },
      { ts: expect.any(String), type: 'tool_result', callId: 'c1', ok: true, result: { path: 'answer.txt', bytes: 2 } },
      { ts: expect.any(String), type: 'step_boundary', step: 2 },
      { ts: expect.any(String), type: 'message', role: 'assistant', content: 'done' },
    ]);
  });

  it('counts cache-creation and cache-read tokens as prompt tokens', async () => {
    const out = await run(runInput([]), fakeQuery([success('ok', usage(10, 5, 100, 50))]));
    expect(out.usage).toEqual({ promptTokens: 160, completionTokens: 5 });
  });

  it('records memory and skill events like the baseline harness', async () => {
    const events: TraceEvent[] = [];
    await run(
      runInput(events, { toolIds: ['memory_read', 'memory_write', 'csv_summary'] }),
      fakeQuery([
        assistant('m1', [
          toolUse('c1', 'memory_read', { query: 'client id' }),
          toolUse('c2', 'memory_write', { key: 'note', value: 'v' }),
          toolUse('c3', 'csv_summary', { path: 'a.csv', column: 'x', op: 'sum' }),
        ]),
        userResults(
          toolResult('c1', { query: 'client id', hits: [{ key: 'client_id', value: 'HL-2044' }] }),
          toolResult('c2', { key: 'note' }),
          toolResult('c3', { result: 3 }),
        ),
        success('ok'),
      ]),
    );

    expect(events.filter((e) => e.type !== 'tool_call' && e.type !== 'tool_result').slice(2)).toEqual([
      { ts: expect.any(String), type: 'memory_read', query: 'client id', hits: [{ key: 'client_id', value: 'HL-2044' }] },
      { ts: expect.any(String), type: 'memory_write', key: 'note', value: 'v' },
      { ts: expect.any(String), type: 'skill_invoke', skillId: 'csv_summary', input: { path: 'a.csv', column: 'x', op: 'sum' } },
    ]);
  });

  it('marks a failed tool call as not ok and records no memory event for it', async () => {
    const events: TraceEvent[] = [];
    await run(
      runInput(events, { toolIds: ['memory_write'] }),
      fakeQuery([
        assistant('m1', [toolUse('c1', 'memory_write', { key: 'k', value: 'v' })]),
        userResults(toolResult('c1', { error: 'disk full' }, true)),
        success('ok'),
      ]),
    );
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false, result: { error: 'disk full' } });
    expect(types(events)).not.toContain('memory_write');
  });

  it('ignores messages from subagents', async () => {
    const events: TraceEvent[] = [];
    const subagent = { ...assistant('s1', [text('inner')]), parent_tool_use_id: 'task-1' };
    await run(runInput(events), fakeQuery([subagent, success('ok')]));
    expect(types(events)).toEqual(['step_boundary', 'message']); // the step marker and the user prompt only
  });
});

describe('ClaudeAgentHarness stop reasons', () => {
  it('maps error_max_turns to max_steps', async () => {
    const out = await run(
      runInput([]),
      fakeQuery([
        assistant('m1', [text('hmm')]),
        { type: 'result', subtype: 'error_max_turns', is_error: false, errors: [], num_turns: 4, usage: usage(1, 1) },
      ]),
    );
    expect(out).toMatchObject({ stoppedReason: 'max_steps', finalAnswer: 'hmm' });
  });

  it('stops at max_tokens when the model wants tools and the budget is exceeded', async () => {
    const events: TraceEvent[] = [];
    const out = await run(
      runInput(events, { budgets: { maxTokens: 1000 } }),
      fakeQuery([
        assistant('m1', [toolUse('c1', 'memory_read', { query: 'x' })], usage(900, 300)),
        success('never reached'),
      ]),
    );
    expect(out).toMatchObject({
      stoppedReason: 'max_tokens',
      finalAnswer: '',
      usage: { promptTokens: 900, completionTokens: 300 },
    });
    expect(types(events)).toEqual(['step_boundary', 'message', 'tool_call']);
  });

  it('does not stop for tokens when the model is already finished', async () => {
    const out = await run(
      runInput([], { budgets: { maxTokens: 1000 } }),
      fakeQuery([assistant('m1', [text('done')], usage(900, 300)), success('done', usage(900, 300))]),
    );
    expect(out.stoppedReason).toBe('completed');
  });

  it('stops with timeout when the time budget runs out, without an error event', async () => {
    const events: TraceEvent[] = [];
    const hang: ClaudeAgentQuery = (params) =>
      (async function* (): AsyncGenerator<SDKMessage> {
        await new Promise((_, reject) =>
          params.options.abortController!.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      })();
    const out = await run(runInput(events, { budgets: { timeoutMs: 30 } }), hang);
    expect(out.stoppedReason).toBe('timeout');
    expect(types(events)).not.toContain('error');
  });

  it('reports an SDK failure as an error event', async () => {
    const events: TraceEvent[] = [];
    const boom: ClaudeAgentQuery = () =>
      (async function* (): AsyncGenerator<SDKMessage> {
        throw new Error('api exploded');
      })();
    const out = await run(runInput(events), boom);
    expect(out.stoppedReason).toBe('error');
    expect(events.at(-1)).toMatchObject({ type: 'error', message: 'api exploded', code: 'agent_sdk_error' });
  });

  it('reports an error result with its messages', async () => {
    const events: TraceEvent[] = [];
    const out = await run(
      runInput(events),
      fakeQuery([
        { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['bad', 'worse'], num_turns: 1, usage: usage(1, 1) },
      ]),
    );
    expect(out.stoppedReason).toBe('error');
    expect(events.at(-1)).toMatchObject({ type: 'error', message: 'bad; worse', code: 'error_during_execution' });
  });

  it('reports a success result that is flagged as an error', async () => {
    const events: TraceEvent[] = [];
    const out = await run(
      runInput(events),
      fakeQuery([{ ...success('rate limited'), is_error: true }]),
    );
    expect(out.stoppedReason).toBe('error');
    expect(events.at(-1)).toMatchObject({ type: 'error', message: 'rate limited' });
  });

  it('reports a stream that ends without a result', async () => {
    const events: TraceEvent[] = [];
    const out = await run(runInput(events), fakeQuery([assistant('m1', [text('hi')])]));
    expect(out).toMatchObject({ stoppedReason: 'error', finalAnswer: 'hi' });
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('without a result') });
  });
});

describe('ClaudeAgentHarness SDK options', () => {
  it('runs in the sandbox with built-in tools off and only the trial tools allowed', async () => {
    const captured: Captured = {};
    await run(runInput([]), fakeQuery([success('ok')], captured));
    expect(captured.options).toMatchObject({
      cwd: sandboxDir,
      model: MODEL,
      maxTurns: 4,
      tools: [],
      allowedTools: ['mcp__evals__write_file', 'mcp__evals__memory_read'],
      permissionMode: 'dontAsk',
      settingSources: [],
      persistSession: false,
      strictMcpConfig: true,
      thinking: { type: 'disabled' },
    });
    expect(Object.keys(captured.options!.mcpServers ?? {})).toEqual(['evals']);
  });

  it('offers no tool server when the trial has no usable tools', async () => {
    const captured: Captured = {};
    await run(runInput([], { toolIds: ['not_a_tool'] }), fakeQuery([success('ok')], captured));
    expect(captured.options?.allowedTools).toEqual([]);
    expect(captured.options?.mcpServers).toBeUndefined();
  });

  it('points Claude Code at OpenRouter and pins every model role', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-real');
    vi.stubEnv('DATABASE_URL', 'postgres://secret');
    const captured: Captured = {};
    await run(runInput([]), fakeQuery([success('ok')], captured));

    const env = captured.options!.env!;
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: 'sk-or-test',
      ANTHROPIC_API_KEY: '', // must stay empty even when the host has a real key
      ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
      ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL: MODEL,
    });
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.DATABASE_URL).toBeUndefined(); // other secrets are not passed on
  });

  it('refuses to run without OPENROUTER_API_KEY', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await expect(new ClaudeAgentHarness().run(runInput([]))).rejects.toThrow('OPENROUTER_API_KEY is not set');
  });
});

describe('ClaudeAgentHarness tool server', () => {
  type ToolServerConfig = { instance: { connect(transport: unknown): Promise<void> } };

  /** A fake `query()` that talks to the harness's in-process tool server as an MCP client would. */
  function queryUsingTools(act: (client: Client) => Promise<void>): ClaudeAgentQuery {
    return (params) =>
      (async function* (): AsyncGenerator<SDKMessage> {
        const server = (params.options.mcpServers as Record<string, ToolServerConfig>).evals!;
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'spec', version: '1.0.0' });
        await Promise.all([server.instance.connect(serverTransport), client.connect(clientTransport)]);
        await act(client);
        await client.close();
        yield success('ok') as SDKMessage;
      })();
  }

  const payloadOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
    JSON.parse((result.content as { text: string }[])[0]!.text) as Record<string, unknown>;

  it('lists exactly the trial tools', async () => {
    let names: string[] = [];
    await run(
      runInput([], { toolIds: ['write_file', 'memory_read', 'not_a_tool'] }),
      queryUsingTools(async (client) => {
        names = (await client.listTools()).tools.map((t) => t.name).sort();
      }),
    );
    expect(names).toEqual(['memory_read', 'write_file']);
  });

  it('runs write_file in the sandbox, like the baseline harness', async () => {
    let result: Awaited<ReturnType<Client['callTool']>> | undefined;
    await run(
      runInput([]),
      queryUsingTools(async (client) => {
        result = await client.callTool({ name: 'write_file', arguments: { path: 'out/answer.txt', content: 'ok' } });
      }),
    );
    expect(result?.isError).toBeFalsy();
    expect(payloadOf(result!)).toEqual({ path: 'out/answer.txt', bytes: 2 });
    expect(await readFile(join(sandboxDir, 'out', 'answer.txt'), 'utf8')).toBe('ok');
  });

  it('refuses paths that escape the sandbox', async () => {
    let result: Awaited<ReturnType<Client['callTool']>> | undefined;
    await run(
      runInput([]),
      queryUsingTools(async (client) => {
        result = await client.callTool({ name: 'write_file', arguments: { path: '../escape.txt', content: 'no' } });
      }),
    );
    expect(result?.isError).toBe(true);
    await expect(readFile(join(sandboxDir, '..', 'escape.txt'), 'utf8')).rejects.toThrow();
  });

  it('serves memory from the trial memory store', async () => {
    let result: Awaited<ReturnType<Client['callTool']>> | undefined;
    await run(
      runInput([]),
      queryUsingTools(async (client) => {
        result = await client.callTool({ name: 'memory_read', arguments: { query: 'client' } });
      }),
    );
    expect(payloadOf(result!)).toEqual({ query: 'client', hits: [{ key: 'client_id', value: 'HL-2044' }] });
  });
});
