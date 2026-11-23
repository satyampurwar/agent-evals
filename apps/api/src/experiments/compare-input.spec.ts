import { describe, expect, it } from 'vitest';
import { toSideInput, type TrialRowForCompare } from './compare-input.js';

const metrics = { latencyMs: 120, totalTokens: 40, estimatedCostUsd: 0.002 };

function row(overrides: Partial<TrialRowForCompare>): TrialRowForCompare {
  return { taskId: 't1', trialIndex: 0, configId: 'A', status: 'succeeded', passed: true, metrics, ...overrides };
}

describe('toSideInput', () => {
  it('scores succeeded trials by their verdict and keeps their metrics', () => {
    const side = toSideInput('A', [row({ passed: false })]);
    expect(side.trials).toEqual([
      {
        taskId: 't1',
        trialIndex: 0,
        passed: false,
        metrics: { latencyMs: 120, totalTokens: 40, estimatedCostUsd: 0.002 },
      },
    ]);
    expect(side.excluded).toEqual({ failed: 0, cancelled: 0, pending: 0 });
  });

  it('scores a timeout as a fail', () => {
    const side = toSideInput('A', [row({ status: 'timeout', passed: false })]);
    expect(side.trials).toHaveLength(1);
    expect(side.trials[0]!.passed).toBe(false);
  });

  it('excludes infrastructure failures and cancellations, and counts pending trials', () => {
    const side = toSideInput('A', [
      row({ trialIndex: 0, status: 'failed', passed: false }),
      row({ trialIndex: 1, status: 'cancelled', passed: false }),
      row({ trialIndex: 2, status: 'queued', passed: null }),
      row({ trialIndex: 3, status: 'running', passed: null }),
      row({ trialIndex: 4, status: 'succeeded', passed: true }),
    ]);
    expect(side.trials.map((t) => t.trialIndex)).toEqual([4]);
    expect(side.excluded).toEqual({ failed: 1, cancelled: 1, pending: 2 });
  });

  it('keeps latency and tokens for a trial with no cost', () => {
    const side = toSideInput('A', [row({ metrics: { latencyMs: 80, totalTokens: 12 } })]);
    expect(side.trials[0]!.metrics).toEqual({ latencyMs: 80, totalTokens: 12 });
  });

  it('leaves metrics off a trial that has none, so means are not pulled down by zeros', () => {
    const side = toSideInput('A', [row({ metrics: {} })]);
    expect(side.trials[0]).not.toHaveProperty('metrics');
  });
});
