import { describe, expect, it } from 'vitest';
import type { Task } from '@agent-evals/domain';
import { BaselineHarness } from '@agent-evals/adapters-harness';
import type { HarnessAdapter } from '@agent-evals/adapters-harness';
import { MockModelAdapter, ScriptedModelAdapter } from '@agent-evals/adapters-model';
import { RunnerError, runTrial } from './run-trial.js';
import type { RunTrialInput } from './run-trial.js';

const addTask: Task = {
  id: 'det_add_01',
  version: '1.0.0',
  name: 'Add',
  description: 'add two numbers',
  prompt: 'What is 40 + 2? Reply with just the number.',
  graders: [{ type: 'exact_match', field: 'final_answer', expected: '42' }],
  tags: ['deterministic'],
};

function input(overrides: Partial<RunTrialInput> = {}): RunTrialInput {
  return {
    trialId: 'trial-test',
    task: addTask,
    harness: new BaselineHarness(),
    model: new MockModelAdapter('42'),
    modelId: 'mock-model',
    modelParams: { temperature: 0 },
    seed: 1,
    budgets: { maxSteps: 4, maxTokens: 256, timeoutMs: 5_000 },
    toolIds: [],
    ...overrides,
  };
}

describe('runTrial', () => {
  it('succeeds and passes when the answer matches', async () => {
    const r = await runTrial(input());
    expect(r.status).toBe('succeeded');
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
    expect(r.error).toBeNull();
    expect(r.finalAnswer).toBe('42');
    expect(r.trace.events.some((e) => e.type === 'message' && e.role === 'assistant')).toBe(true);
  });

  it('succeeds but does not pass when the agent answers wrong (scored failure)', async () => {
    const r = await runTrial(input({ model: new MockModelAdapter('41') }));
    expect(r.status).toBe('succeeded');
    expect(r.passed).toBe(false);
    expect(r.grade?.passed).toBe(false);
    expect(r.error).toBeNull();
  });

  it('marks a model error as failed (infra) and retryable, and keeps the grade', async () => {
    const r = await runTrial(input({ model: new ScriptedModelAdapter([]) }));
    expect(r.status).toBe('failed');
    expect(r.passed).toBe(false);
    expect(r.error).toMatchObject({ code: 'model_error', retryable: true });
    expect(r.error?.message).toMatch(/scripted model exhausted/);
    expect(r.trace.events.some((e) => e.type === 'error')).toBe(true);
  });

  it('enforces the wall-clock budget even when the harness never returns', async () => {
    const hang: HarnessAdapter = {
      id: 'hang',
      displayName: 'hangs forever',
      run: () => new Promise(() => {}),
    };
    const started = Date.now();
    const r = await runTrial(input({ harness: hang, budgets: { maxSteps: 4, maxTokens: 256, timeoutMs: 30 } }));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.status).toBe('timeout');
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
    expect(r.grade).toBeNull();
    expect(r.error).toMatchObject({ code: 'timeout', retryable: false });
  });

  it('marks an unsupported grader as failed (infra), not as a scored failure', async () => {
    const task: Task = {
      ...addTask,
      graders: [{ type: 'llm_judge', rubricId: 'summary_v1', judgeModel: 'openai/gpt-4.1-mini', passThreshold: 0.7 }],
    };
    const r = await runTrial(input({ task }));
    expect(r.status).toBe('failed');
    expect(r.error).toMatchObject({ code: 'grader_not_implemented', retryable: false });
    expect(r.passed).toBe(false);
  });

  it('runs a unit_test grader against the sandbox the agent wrote to', async () => {
    const task: Task = {
      ...addTask,
      setup: { files: { 'test_double.js': "const { double } = require('./solution.js');\nif (double(4) !== 8) process.exit(1);\n" } },
      graders: [{ type: 'unit_test', command: 'node test_double.js', timeoutMs: 5000 }],
    };
    const writesSolution = new ScriptedModelAdapter([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', name: 'write_file', arguments: { path: 'solution.js', content: 'exports.double = (x) => x * 2;' } },
          ],
        },
        usage: { promptTokens: 1, completionTokens: 1 },
      },
      {
        message: { role: 'assistant', content: 'done' },
        usage: { promptTokens: 1, completionTokens: 1 },
      },
    ]);
    const r = await runTrial(input({ task, model: writesSolution, toolIds: ['write_file'] }));
    expect(r.status).toBe('succeeded');
    expect(r.passed).toBe(true);
    expect(r.grade?.graderResults[0]).toMatchObject({ graderType: 'unit_test', passed: true });
  });

  it('reports token usage and step count from the harness', async () => {
    const r = await runTrial(input());
    expect(r.metrics.promptTokens).toBe(10);
    expect(r.metrics.completionTokens).toBe(2);
    expect(r.metrics.totalTokens).toBe(12);
    expect(r.metrics.stepCount).toBeGreaterThanOrEqual(1);
  });
});
