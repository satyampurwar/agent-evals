import { describe, expect, it } from 'vitest';
import {
  bootstrapMeanCI,
  mcNemar,
  pairedBootstrapDelta,
  passRate,
  wilsonInterval,
  mulberry32,
} from './index.js';

// Hand-checked vector from EXECUTION_PLAN.md §10.2.
const A = [1, 1, 0, 1, 0];
const B = [1, 0, 0, 0, 0];

describe('passRate', () => {
  it('is the mean of the scores', () => {
    expect(passRate(A)).toBeCloseTo(0.6, 12);
    expect(passRate(B)).toBeCloseTo(0.2, 12);
  });

  it('throws on empty input rather than returning a made-up zero', () => {
    expect(() => passRate([])).toThrow(RangeError);
  });
});

describe('wilsonInterval', () => {
  it('handles 0 and n passes without leaving [0, 1]', () => {
    const none = wilsonInterval(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775, 3);

    const all = wilsonInterval(10, 10);
    expect(all.high).toBeCloseTo(1, 9);
    expect(all.low).toBeCloseTo(0.7225, 3);
  });

  it('centres near the observed rate for 5 of 10', () => {
    const ci = wilsonInterval(5, 10);
    expect(ci.low).toBeCloseTo(0.2366, 3);
    expect(ci.high).toBeCloseTo(0.7634, 3);
  });

  it('narrows as n grows at the same rate', () => {
    const small = wilsonInterval(5, 10);
    const large = wilsonInterval(50, 100);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('rejects impossible arguments', () => {
    expect(() => wilsonInterval(11, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 10)).toThrow(RangeError);
    expect(() => wilsonInterval(1, 0)).toThrow(RangeError);
    expect(() => wilsonInterval(1.5, 10)).toThrow(RangeError);
  });
});

describe('bootstrapMeanCI', () => {
  it('gives a degenerate interval for constant values', () => {
    const ci = bootstrapMeanCI([0.5, 0.5, 0.5]);
    expect(ci).toEqual({ mean: 0.5, low: 0.5, high: 0.5 });
  });

  it('brackets the mean and is reproducible for a fixed seed', () => {
    const first = bootstrapMeanCI(A, 2000, 0.05, 7);
    const second = bootstrapMeanCI(A, 2000, 0.05, 7);
    expect(first).toEqual(second);
    expect(first.low).toBeLessThanOrEqual(first.mean);
    expect(first.high).toBeGreaterThanOrEqual(first.mean);
  });
});

describe('pairedBootstrapDelta', () => {
  it('gives delta = mean(A) - mean(B) with a finite interval, positive for the hand-checked vector', () => {
    const d = pairedBootstrapDelta(A, B);
    expect(d.delta).toBeCloseTo(0.4, 12);
    expect(Number.isFinite(d.low)).toBe(true);
    expect(Number.isFinite(d.high)).toBe(true);
    expect(d.low).toBeGreaterThanOrEqual(-1);
    expect(d.high).toBeLessThanOrEqual(1);
    expect(d.low).toBeLessThanOrEqual(d.delta);
    expect(d.high).toBeGreaterThanOrEqual(d.delta);
  });

  it('is negative when B is the better side', () => {
    expect(pairedBootstrapDelta(B, A).delta).toBeCloseTo(-0.4, 12);
  });

  it('rejects unpaired samples', () => {
    expect(() => pairedBootstrapDelta([1, 0], [1])).toThrow(RangeError);
  });
});

describe('mcNemar', () => {
  it('matches the hand-checked vector: 2 discordant pairs, both favouring A, p = 0.5', () => {
    const pairs = A.map((a, i) => ({ a: a === 1, b: B[i] === 1 }));
    const r = mcNemar(pairs);
    expect(r.aOnly).toBe(2);
    expect(r.bOnly).toBe(0);
    expect(r.pValue).toBeCloseTo(0.5, 12);
  });

  it('gives the exact two-sided p for 5 discordant pairs all favouring one side, p = 0.0625', () => {
    const pairs = [
      ...Array.from({ length: 5 }, () => ({ a: true, b: false })),
      ...Array.from({ length: 3 }, () => ({ a: true, b: true })),
    ];
    expect(mcNemar(pairs).pValue).toBeCloseTo(0.0625, 12);
  });

  it('is 1 when there are no discordant pairs', () => {
    expect(mcNemar([{ a: true, b: true }, { a: false, b: false }]).pValue).toBe(1);
  });

  it('is 1 for a perfectly balanced split', () => {
    const pairs = [
      ...Array.from({ length: 3 }, () => ({ a: true, b: false })),
      ...Array.from({ length: 3 }, () => ({ a: false, b: true })),
    ];
    expect(mcNemar(pairs).pValue).toBe(1);
  });
});

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = r1();
      expect(x).toBe(r2());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
