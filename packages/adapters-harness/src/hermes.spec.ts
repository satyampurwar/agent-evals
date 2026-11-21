import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskSchema } from '@agent-evals/domain';
import type { TraceEvent } from '@agent-evals/domain';
import { MockModelAdapter } from '@agent-evals/adapters-model';
import { HermesHarness } from './hermes';
import { noopMemory } from './types';
import type { HarnessRunInput } from './types';

// A stand-in for the Python worker: records each request and answers with whatever the test sets up.
type Reply = (body: Record<string, unknown>, res: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let reply: Reply;
let received: { path: string | undefined; body: Record<string, unknown> } | undefined;

beforeEach(async () => {
  reply = (_body, res) => respond(res, 500, 'no reply configured');
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    received = { path: req.url, body };
    reply(body, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  received = undefined;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function respond(res: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' });
  res.end(text);
}

const task = TaskSchema.parse({
  id: 'mem_recall_client_01',
  version: '1.0.0',
  name: 'Recall the client ID',
  description: 'd',
  prompt: 'What is the client ID?',
  graders: [],
  tags: ['memory'],
  setup: { memory: { client_id: 'HL-2044' } },
  toolsAllowed: ['memory_read'],
});

function runInput(events: TraceEvent[], overrides: Partial<HarnessRunInput['modelParams']> = {}): HarnessRunInput {
  return {
    task,
    model: new MockModelAdapter('unused'),
    modelId: 'openai/gpt-4.1-mini',
    modelParams: { temperature: 0.3, ...overrides },
    context: {
      trialId: 'trial-1',
      seed: 7,
      sandboxDir: '/tmp/sandbox-1',
      budgets: { maxSteps: 4, maxTokens: 900, timeoutMs: 5000 },
      memory: noopMemory,
      skillIds: [],
      toolIds: ['memory_read', 'read_file'],
      emit: (event) => events.push(event),
    },
  };
}

const ts = '2026-01-01T00:00:00.000Z';

describe('HermesHarness', () => {
  it('posts the trial to the worker and emits the reply events in order', async () => {
    reply = (_body, res) =>
      respond(res, 200, {
        finalAnswer: 'HL-2044',
        stoppedReason: 'completed',
        events: [
          { ts, type: 'message', role: 'user', content: 'What is the client ID?' },
          { ts, type: 'memory_read', query: 'client id', hits: [{ key: 'client_id', value: 'HL-2044' }] },
          { ts, type: 'message', role: 'assistant', content: 'HL-2044' },
        ],
        usage: { promptTokens: 200, completionTokens: 20 },
        stepCount: 2,
      });

    const events: TraceEvent[] = [];
    const out = await new HermesHarness({ workerUrl: baseUrl }).run(runInput(events));

    expect(received?.path).toBe('/run-trial');
    expect(received?.body).toEqual({
      trialId: 'trial-1',
      task: { id: 'mem_recall_client_01', prompt: 'What is the client ID?' },
      config: { modelId: 'openai/gpt-4.1-mini', temperature: 0.3, maxSteps: 4, maxTokens: 900, timeoutMs: 5000 },
      toolIds: ['memory_read', 'read_file'],
      memorySeed: { client_id: 'HL-2044' },
      sandboxDir: '/tmp/sandbox-1',
      seed: 7,
    });
    expect(out).toEqual({
      finalAnswer: 'HL-2044',
      stoppedReason: 'completed',
      usage: { promptTokens: 200, completionTokens: 20 },
      stepCount: 2,
    });
    expect(events.map((e) => e.type)).toEqual(['message', 'memory_read', 'message']);
  });

  it('sends topP only when the config sets it, and an empty memory seed when the task has none', async () => {
    reply = (_body, res) => respond(res, 200, { finalAnswer: '', stoppedReason: 'error', events: [], usage: { promptTokens: 0, completionTokens: 0 }, stepCount: 0 });
    const plain = { ...task, setup: undefined };
    await new HermesHarness({ workerUrl: baseUrl }).run({ ...runInput([], { topP: 0.9 }), task: plain });
    const config = received?.body.config as Record<string, unknown>;
    expect(config.topP).toBe(0.9);
    expect(received?.body.memorySeed).toEqual({});

    await new HermesHarness({ workerUrl: baseUrl }).run(runInput([]));
    expect((received?.body.config as Record<string, unknown>).topP).toBeUndefined();
  });

  it('rejects a trace event that does not match the domain schema', async () => {
    reply = (_body, res) =>
      respond(res, 200, {
        finalAnswer: '',
        stoppedReason: 'completed',
        events: [{ ts, type: 'not_an_event' }],
        usage: { promptTokens: 0, completionTokens: 0 },
        stepCount: 1,
      });
    await expect(new HermesHarness({ workerUrl: baseUrl }).run(runInput([]))).rejects.toThrow(
      /invalid trace event/,
    );
  });

  it('turns a worker error status into an error that carries the detail', async () => {
    reply = (_body, res) => respond(res, 500, 'OPENROUTER_API_KEY is not set');
    await expect(new HermesHarness({ workerUrl: baseUrl }).run(runInput([]))).rejects.toThrow(
      'hermes worker returned 500: OPENROUTER_API_KEY is not set',
    );
  });

  it('rejects a malformed reply', async () => {
    reply = (_body, res) => respond(res, 200, { finalAnswer: 3, stoppedReason: 'completed', events: [] });
    await expect(new HermesHarness({ workerUrl: baseUrl }).run(runInput([]))).rejects.toThrow(
      'finalAnswer must be a string',
    );
  });

  it('rejects a reply that is not JSON', async () => {
    reply = (_body, res) => respond(res, 200, '<html>proxy error</html>');
    await expect(new HermesHarness({ workerUrl: baseUrl }).run(runInput([]))).rejects.toThrow(/non-JSON reply/);
  });

  it('reports an unreachable worker', async () => {
    await expect(new HermesHarness({ workerUrl: 'http://127.0.0.1:1' }).run(runInput([]))).rejects.toThrow(
      /hermes worker unreachable at http:\/\/127\.0\.0\.1:1/,
    );
  });

  it('reads the worker URL from HERMES_WORKER_URL and tolerates a trailing slash', async () => {
    reply = (_body, res) =>
      respond(res, 200, { finalAnswer: 'ok', stoppedReason: 'completed', events: [], usage: { promptTokens: 1, completionTokens: 1 }, stepCount: 1 });
    const previous = process.env.HERMES_WORKER_URL;
    process.env.HERMES_WORKER_URL = `${baseUrl}/`;
    try {
      const out = await new HermesHarness().run(runInput([]));
      expect(out.finalAnswer).toBe('ok');
      expect(received?.path).toBe('/run-trial');
    } finally {
      if (previous === undefined) delete process.env.HERMES_WORKER_URL;
      else process.env.HERMES_WORKER_URL = previous;
    }
  });
});
