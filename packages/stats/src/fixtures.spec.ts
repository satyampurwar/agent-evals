import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareConfigs, type ScoredTrial, type SideInput } from './index.js';

interface Outcome {
  taskId: string;
  trialIndex: number;
  a: boolean;
  b: boolean;
}

// Fixtures live at the repo root; this spec sits at packages/stats/src.
function loadOutcomes(name: string): Outcome[] {
  const path = new URL(`../../../fixtures/stats/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(path, 'utf8')) as { outcomes: Outcome[] }).outcomes;
}

function sides(outcomes: Outcome[]): { a: SideInput; b: SideInput } {
  const none = { failed: 0, cancelled: 0, pending: 0 };
  const toTrials = (pick: 'a' | 'b'): ScoredTrial[] =>
    outcomes.map((o) => ({ taskId: o.taskId, trialIndex: o.trialIndex, passed: o[pick] }));
  return {
    a: { configId: 'A', trials: toTrials('a'), excluded: none },
    b: { configId: 'B', trials: toTrials('b'), excluded: none },
  };
}

describe('checkpoint 10 fixtures', () => {
  it('known gap: A is significantly better, with a CI that excludes 0', () => {
    const { a, b } = sides(loadOutcomes('known_gap'));
    const r = compareConfigs(a, b);
    expect(r.verdict).toBe('a_better');
    expect(r.noise).toBe(false);
    expect(r.delta.ci!.low).toBeGreaterThan(0);
    expect(r.delta.pValue).toBeLessThan(0.05);
  });

  it('coin flip: the difference is likely noise, with a CI that includes 0', () => {
    const { a, b } = sides(loadOutcomes('coin_flip'));
    const r = compareConfigs(a, b);
    expect(r.verdict).toBe('likely_noise');
    expect(r.noise).toBe(true);
    expect(r.delta.ci!.low).toBeLessThanOrEqual(0);
    expect(r.delta.ci!.high).toBeGreaterThanOrEqual(0);
  });
});
