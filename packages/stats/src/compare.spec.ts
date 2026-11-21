import { describe, expect, it } from 'vitest';
import { compareConfigs, NothingToCompareError, type ScoredTrial, type SideInput } from './index.js';

const NO_EXCLUSIONS = { failed: 0, cancelled: 0, pending: 0 };

/** Builds one side from a map of taskId -> per-trial outcomes (true = passed). */
function side(configId: string, outcomes: Record<string, boolean[]>, excluded = NO_EXCLUSIONS): SideInput {
  const trials: ScoredTrial[] = [];
  for (const [taskId, passes] of Object.entries(outcomes)) {
    passes.forEach((passed, trialIndex) => trials.push({ taskId, trialIndex, passed }));
  }
  return { configId, trials, excluded };
}

/** Eight tasks, five trials each. `aRate` and `bRate` are per-task pass counts out of 5. */
function tasks(aPasses: number[], bPasses: number[]): { a: Record<string, boolean[]>; b: Record<string, boolean[]> } {
  const a: Record<string, boolean[]> = {};
  const b: Record<string, boolean[]> = {};
  aPasses.forEach((p, i) => {
    a[`task_${i}`] = Array.from({ length: 5 }, (_, k) => k < p);
    b[`task_${i}`] = Array.from({ length: 5 }, (_, k) => k < bPasses[i]!);
  });
  return { a, b };
}

describe('compareConfigs', () => {
  it('reports a clear gap as a_better with an interval that excludes 0', () => {
    const { a, b } = tasks([5, 5, 5, 4, 5, 5, 4, 5], [1, 0, 2, 1, 0, 1, 2, 0]);
    const r = compareConfigs(side('A', a), side('B', b));
    expect(r.verdict).toBe('a_better');
    expect(r.noise).toBe(false);
    expect(r.delta.value).toBeGreaterThan(0.5);
    expect(r.delta.ci).not.toBeNull();
    expect(r.delta.ci!.low).toBeGreaterThan(0);
    expect(r.delta.pValue).toBeLessThan(0.05);
  });

  it('reports b_better when B is the stronger side', () => {
    const { a, b } = tasks([1, 0, 2, 1, 0, 1, 2, 0], [5, 5, 5, 4, 5, 5, 4, 5]);
    const r = compareConfigs(side('A', a), side('B', b));
    expect(r.verdict).toBe('b_better');
    expect(r.delta.value).toBeLessThan(0);
  });

  it('calls two near-identical sides likely noise', () => {
    const { a, b } = tasks([3, 2, 4, 1, 3, 2, 4, 3], [2, 3, 3, 2, 4, 2, 3, 2]);
    const r = compareConfigs(side('A', a), side('B', b));
    expect(r.noise).toBe(true);
    expect(r.verdict).toBe('likely_noise');
    expect(r.delta.ci!.low).toBeLessThanOrEqual(0);
    expect(r.delta.ci!.high).toBeGreaterThanOrEqual(0);
  });

  it('macro pass rate weights each task equally, whatever its trial count', () => {
    const a = side('A', { t1: [true, true, true, true], t2: [false] });
    const b = side('B', { t1: [false], t2: [false] });
    const r = compareConfigs(a, b);
    // Macro over tasks: A = (1 + 0) / 2 = 0.5. Pooled trials would give 3/5 = 0.6.
    expect(r.a.passRate).toBeCloseTo(0.5, 12);
    expect(r.b.passRate).toBeCloseTo(0, 12);
  });

  it('reports per-task deltas, sorted by task id, and only for tasks both sides scored', () => {
    const a = side('A', { beta: [true], alpha: [true, false], only_a: [true] });
    const b = side('B', { alpha: [false, false], beta: [false], only_b: [true] });
    const r = compareConfigs(a, b);
    expect(r.commonTasks).toBe(2);
    expect(r.perTask.map((t) => t.taskId)).toEqual(['alpha', 'beta']);
    expect(r.perTask[0]!.delta).toBeCloseTo(0.5, 12);
    expect(r.perTask[1]!.delta).toBeCloseTo(1, 12);
  });

  it('counts only paired (task, trialIndex) outcomes for McNemar', () => {
    const a = side('A', { t1: [true, false] });
    const b = side('B', { t1: [false, false] });
    const r = compareConfigs(a, b);
    expect(r.pairedTrials).toBe(2);
    expect(r.delta.discordant).toEqual({ aOnly: 1, bOnly: 0 });
  });

  it('says insufficient_data with one common task and does not compute a delta interval', () => {
    const r = compareConfigs(side('A', { t1: [true, true] }), side('B', { t1: [false, false] }));
    expect(r.verdict).toBe('insufficient_data');
    expect(r.noise).toBe(true);
    expect(r.delta.ci).toBeNull();
    expect(r.notes.join(' ')).toMatch(/at least 2 tasks/);
  });

  it('throws NothingToCompareError when the two sides share no task', () => {
    expect(() => compareConfigs(side('A', { t1: [true] }), side('B', { t2: [true] }))).toThrow(NothingToCompareError);
  });

  it('rejects duplicate (task, trialIndex) rows rather than averaging them silently', () => {
    const a: SideInput = {
      configId: 'A',
      trials: [
        { taskId: 't1', trialIndex: 0, passed: true },
        { taskId: 't1', trialIndex: 0, passed: false },
      ],
      excluded: NO_EXCLUSIONS,
    };
    expect(() => compareConfigs(a, side('B', { t1: [true] }))).toThrow(/duplicate trial t1#0/);
  });

  it('passes excluded counts through and notes them', () => {
    const excluded = { failed: 2, cancelled: 1, pending: 3 };
    const r = compareConfigs(side('A', { t1: [true], t2: [true] }, excluded), side('B', { t1: [true], t2: [false] }));
    expect(r.a.excluded).toEqual(excluded);
    expect(r.notes.join(' ')).toMatch(/A failed 2, cancelled 1, pending 3/);
  });

  it('averages side metrics over trials that have them, and reports null when none do', () => {
    const a: SideInput = {
      configId: 'A',
      trials: [
        { taskId: 't1', trialIndex: 0, passed: true, metrics: { latencyMs: 100, totalTokens: 10, estimatedCostUsd: 0.01 } },
        { taskId: 't2', trialIndex: 0, passed: true, metrics: { latencyMs: 300, totalTokens: 30, estimatedCostUsd: 0.03 } },
        { taskId: 't3', trialIndex: 0, passed: false },
      ],
      excluded: NO_EXCLUSIONS,
    };
    const b = side('B', { t1: [true], t2: [true], t3: [true] });
    const r = compareConfigs(a, b);
    expect(r.a.meanLatencyMs).toBe(200);
    expect(r.a.meanTotalTokens).toBe(20);
    expect(r.a.meanCostUsd).toBeCloseTo(0.02, 12);
    expect(r.b.meanLatencyMs).toBeNull();
  });

  it('reports a null cost mean when no trial has a cost, while latency and tokens still average', () => {
    const a: SideInput = {
      configId: 'A',
      trials: [
        { taskId: 't1', trialIndex: 0, passed: true, metrics: { latencyMs: 100, totalTokens: 10 } },
        { taskId: 't2', trialIndex: 0, passed: true, metrics: { latencyMs: 300, totalTokens: 30 } },
      ],
      excluded: NO_EXCLUSIONS,
    };
    const r = compareConfigs(a, side('B', { t1: [true], t2: [true] }));
    expect(r.a.meanCostUsd).toBeNull();
    expect(r.a.meanLatencyMs).toBe(200);
    expect(r.a.meanTotalTokens).toBe(20);
  });

  it('is deterministic for a fixed seed', () => {
    const { a, b } = tasks([3, 2, 4, 1, 3, 2, 4, 3], [2, 3, 3, 2, 4, 2, 3, 2]);
    const r1 = compareConfigs(side('A', a), side('B', b), { seed: 9, resamples: 500 });
    const r2 = compareConfigs(side('A', a), side('B', b), { seed: 9, resamples: 500 });
    expect(r1).toEqual(r2);
  });
});
