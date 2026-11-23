/**
 * Pass-rate helpers for scored trials (0/1 or fractional scores).
 *
 * The simplest summary of an experiment side is “what fraction passed?” `passRate` is that mean.
 * `wilsonInterval` is a better CI for binomial proportions than the normal approximation when
 * pass counts are near 0 or n. Macro comparisons in `compare.ts` usually bootstrap per-task rates
 * instead; Wilson is available for single-proportion summaries.
 */

/** Closed confidence interval. */
export interface Interval {
  low: number;
  high: number;
}

/** z for a two-sided 95% interval. */
export const Z_95 = 1.959963984540054;

/** Mean of 0/1 (or fractional) scores. Throws on empty input: an empty pass rate is undefined, not zero. */
export function passRate(scores: readonly number[]): number {
  if (scores.length === 0) throw new RangeError('passRate needs at least one score');
  let sum = 0;
  for (const s of scores) sum += s;
  return sum / scores.length;
}

/**
 * Wilson score interval for a pass count out of n trials. It stays inside [0, 1] and behaves
 * sensibly at 0 and n passes, where the normal approximation (p ± z·sqrt(p(1-p)/n)) does not.
 */
export function wilsonInterval(passes: number, n: number, z: number = Z_95): Interval {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('wilsonInterval needs n >= 1');
  if (!Number.isInteger(passes) || passes < 0 || passes > n) {
    throw new RangeError(`wilsonInterval passes must be an integer in [0, ${n}]`);
  }
  const p = passes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}
