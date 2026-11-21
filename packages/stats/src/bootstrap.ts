import { mulberry32 } from './rng.js';
import type { Interval } from './pass-rate.js';

export const DEFAULT_RESAMPLES = 5000;
export const DEFAULT_ALPHA = 0.05;
export const DEFAULT_SEED = 1;

export interface MeanCI extends Interval {
  mean: number;
}

export interface DeltaCI extends Interval {
  delta: number;
}

function assertBootstrapArgs(B: number, alpha: number): void {
  if (!Number.isInteger(B) || B < 1) throw new RangeError('bootstrap resamples must be a positive integer');
  if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha must be between 0 and 1');
}

function meanOf(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Percentile bootstrap CI for the mean. Resamples the values with replacement B times and takes the
 * alpha/2 and 1-alpha/2 quantiles of the resampled means. Deterministic for a given seed.
 */
export function bootstrapMeanCI(
  values: readonly number[],
  B: number = DEFAULT_RESAMPLES,
  alpha: number = DEFAULT_ALPHA,
  seed: number = DEFAULT_SEED,
): MeanCI {
  if (values.length === 0) throw new RangeError('bootstrapMeanCI needs at least one value');
  assertBootstrapArgs(B, alpha);
  const n = values.length;
  const rand = mulberry32(seed);
  const means = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)]!;
    means[b] = sum / n;
  }
  means.sort();
  const low = means[Math.floor((alpha / 2) * B)]!;
  const high = means[Math.min(B - 1, Math.floor((1 - alpha / 2) * B))]!;
  return { mean: meanOf(values), low, high };
}

/**
 * Paired bootstrap CI for the difference a - b. The pairs are resampled together, so the
 * correlation between the two sides (same task, same trial) is kept. Delta is positive when a is higher.
 */
export function pairedBootstrapDelta(
  a: readonly number[],
  b: readonly number[],
  B: number = DEFAULT_RESAMPLES,
  alpha: number = DEFAULT_ALPHA,
  seed: number = DEFAULT_SEED,
): DeltaCI {
  if (a.length !== b.length) throw new RangeError('paired samples must have the same length');
  if (a.length === 0) throw new RangeError('pairedBootstrapDelta needs at least one pair');
  const diffs = a.map((x, i) => x - b[i]!);
  const ci = bootstrapMeanCI(diffs, B, alpha, seed);
  return { delta: ci.mean, low: ci.low, high: ci.high };
}
