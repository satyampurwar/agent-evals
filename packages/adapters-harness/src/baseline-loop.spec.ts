import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskSchema } from '@agent-evals/domain';
import type { TraceEvent } from '@agent-evals/domain';
import { ScriptedModelAdapter } from '@agent-evals/adapters-model';
import type { ModelResponse } from '@agent-evals/adapters-model';
import { BaselineHarness } from './baseline';
import { createTrialMemory } from './memory';
import { noopMemory } from './types';

let sandboxDir: string;

beforeEach(async () => {
  sandboxDir = await mkdtemp(join(tmpdir(), 'loop-spec-'));
});

afterEach(async () => {
  await rm(sandboxDir, { recursive: true, force: true });
});

const usage = { promptTokens: 5, completionTokens: 5 };
const reply = (content: string): ModelResponse => ({ message: { role: 'assistant', content }, usage });
const call = (id: string, name: string, args: Record<string, unknown>): ModelResponse => ({
  message: { role: 'assistant', content: '', toolCalls: [{ id, name, arguments: args }] },
  usage,
});

function task(toolsAllowed?: string[]) {
  return TaskSchema.parse({
    id: 't',
    version: '1.0.0',
    name: 'n',
    description: 'd',
    prompt: 'Write answer.txt with ok.',
    graders: [],
    tags: [],
    toolsAllowed,
  });
}

async function run(script: ModelResponse[], opts: { maxSteps?: number; maxTokens?: number; toolIds?: string[] } = {}) {
  const events: TraceEvent[] = [];
  const model = new ScriptedModelAdapter(script);
  const out = await new BaselineHarness().run({
    task: task(),
    model,
    modelId: 'scripted',
    modelParams: { temperature: 0 },
    context: {
      trialId: 'trial-loop',
      seed: 0,
      sandboxDir,
      budgets: { maxSteps: opts.maxSteps ?? 5, maxTokens: opts.maxTokens ?? 1000, timeoutMs: 10_000 },
      memory: noopMemory,
      skillIds: [],
      toolIds: opts.toolIds ?? ['write_file', 'read_file', 'list_dir'],
      emit: (e) => events.push(e),
    },
  });
  return { out, events, model };
}

describe('BaselineHarness tool loop', () => {
  it('runs a tool call, feeds the result back, then completes', async () => {
    const { out, events, model } = await run([
      call('c1', 'write_file', { path: 'answer.txt', content: 'ok' }),
      reply('done'),
    ]);

    expect(out).toMatchObject({ finalAnswer: 'done', stoppedReason: 'completed', stepCount: 2 });
    expect(await readFile(join(sandboxDir, 'answer.txt'), 'utf8')).toBe('ok');

    // second request carries the tool result back to the model
    const second = model.requests[1].messages;
    expect(second.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'c1', name: 'write_file' });

    expect(events.filter((e) => e.type === 'tool_call')).toMatchObject([{ name: 'write_file', callId: 'c1' }]);
    expect(events.filter((e) => e.type === 'tool_result')).toMatchObject([{ callId: 'c1', ok: true }]);
    expect(events.filter((e) => e.type === 'step_boundary')).toMatchObject([{ step: 1 }, { step: 2 }]);
  });

  it('sends tool specs only for the allowed tool ids', async () => {
    const { model } = await run([reply('done')], { toolIds: ['read_file'] });
    expect(model.requests[0].tools?.map((t) => t.name)).toEqual(['read_file']);
  });

  it('omits tools entirely when none are allowed', async () => {
    const { model, out } = await run([reply('42')], { toolIds: [] });
    expect(model.requests[0].tools).toBeUndefined();
    expect(out).toMatchObject({ finalAnswer: '42', stoppedReason: 'completed', stepCount: 1 });
  });

  it('stops with max_steps when the model keeps calling tools', async () => {
    const { out } = await run(
      [
        call('c1', 'list_dir', { path: '.' }),
        call('c2', 'list_dir', { path: '.' }),
        call('c3', 'list_dir', { path: '.' }),
      ],
      { maxSteps: 2 },
    );
    expect(out).toMatchObject({ stoppedReason: 'max_steps', stepCount: 2 });
  });

  it('stops with max_tokens when the total budget is exceeded', async () => {
    const { out } = await run([call('c1', 'list_dir', { path: '.' }), reply('never reached')], { maxTokens: 5 });
    expect(out).toMatchObject({ stoppedReason: 'max_tokens', stepCount: 1 });
  });

  it('reports a failed tool call as ok:false and lets the model continue', async () => {
    const { out, events } = await run([call('c1', 'read_file', { path: 'missing.txt' }), reply('gave up')]);
    expect(out).toMatchObject({ finalAnswer: 'gave up', stoppedReason: 'completed' });
    expect(events.filter((e) => e.type === 'tool_result')).toMatchObject([{ ok: false }]);
    expect(existsSync(join(sandboxDir, 'missing.txt'))).toBe(false);
  });

  it('returns stoppedReason error when the model throws', async () => {
    const { out, events } = await run([]);
    expect(out).toMatchObject({ stoppedReason: 'error', stepCount: 1 });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'model_error' });
  });

  it('refuses a tool the trial was not offered, even if the model names it', async () => {
    const { out, events } = await run(
      [call('c1', 'write_file', { path: 'answer.txt', content: 'ok' }), reply('done')],
      { toolIds: ['read_file'] },
    );
    expect(out.stoppedReason).toBe('completed');
    expect(existsSync(join(sandboxDir, 'answer.txt'))).toBe(false);
    expect(events.filter((e) => e.type === 'tool_result')).toMatchObject([
      { callId: 'c1', ok: false, result: { error: 'tool not available in this trial: write_file' } },
    ]);
  });
});

describe('BaselineHarness memory and skill events', () => {
  async function runWithMemory(script: ModelResponse[], seed: Record<string, string>, toolIds: string[]) {
    const events: TraceEvent[] = [];
    const out = await new BaselineHarness().run({
      task: task(),
      model: new ScriptedModelAdapter(script),
      modelId: 'scripted',
      modelParams: { temperature: 0 },
      context: {
        trialId: 'trial-mem',
        seed: 0,
        sandboxDir,
        budgets: { maxSteps: 5, maxTokens: 1000, timeoutMs: 10_000 },
        memory: createTrialMemory(seed),
        skillIds: [],
        toolIds,
        emit: (e) => events.push(e),
      },
    });
    return { out, events };
  }

  it('emits memory_read with the hits the tool returned', async () => {
    const { events } = await runWithMemory(
      [call('m1', 'memory_read', { query: 'client id' }), reply('HL-2044')],
      { client_id: 'HL-2044' },
      ['memory_read'],
    );
    expect(events.find((e) => e.type === 'memory_read')).toMatchObject({
      type: 'memory_read',
      query: 'client id',
      hits: [{ key: 'client_id', value: 'HL-2044' }],
    });
  });

  it('emits memory_write after a successful write, and the value is readable in the same trial', async () => {
    const { events } = await runWithMemory(
      [
        call('w1', 'memory_write', { key: 'color', value: 'blue' }),
        call('r1', 'memory_read', { query: 'color' }),
        reply('blue'),
      ],
      {},
      ['memory_read', 'memory_write'],
    );
    expect(events.find((e) => e.type === 'memory_write')).toMatchObject({ key: 'color', value: 'blue' });
    expect(events.find((e) => e.type === 'memory_read')).toMatchObject({ hits: [{ key: 'color', value: 'blue' }] });
  });

  it('does not reach seeded memory when the memory tools were not offered', async () => {
    const { events } = await runWithMemory(
      [call('m1', 'memory_read', { query: 'client id' }), reply('unknown')],
      { client_id: 'HL-2044' },
      [],
    );
    expect(events.find((e) => e.type === 'memory_read')).toBeUndefined();
    expect(events.filter((e) => e.type === 'tool_result')).toMatchObject([{ ok: false }]);
  });

  it('emits skill_invoke for a skill tool call', async () => {
    const csv = ['region,amount', 'north,10', 'south,5'].join('\n');
    await writeFile(join(sandboxDir, 'sales.csv'), csv);
    const { events } = await runWithMemory(
      [call('s1', 'csv_summary', { path: 'sales.csv', column: 'amount', op: 'sum' }), reply('15')],
      {},
      ['csv_summary'],
    );
    expect(events.find((e) => e.type === 'skill_invoke')).toMatchObject({ skillId: 'csv_summary' });
    expect(events.filter((e) => e.type === 'tool_result')).toMatchObject([
      { ok: true, result: { value: 15, rows: 2 } },
    ]);
  });
});
