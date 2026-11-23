/**
 * McNemar's test for paired pass/fail outcomes (config A vs B on the same trial index).
 *
 * Only **discordant** pairs matter: A passed & B failed, or the reverse. Under the null that both
 * configs are equally good, those flips are coin tosses — the exact binomial p-value tests that.
 * Reported alongside the bootstrap CI in `compareConfigs`; the verdict itself uses the CI.
 */

export interface PairedOutcome {
  a: boolean;
  b: boolean;
}

export interface McNemarResult {
  /** Pairs where a passed and b failed. */
  aOnly: number;
  /** Pairs where b passed and a failed. */
  bOnly: number;
  /** Two-sided exact p-value (binomial test on the discordant pairs). 1 when there are no discordant pairs. */
  pValue: number;
}

/**
 * McNemar's test for paired binary outcomes, in its exact form. Only discordant pairs carry information.
 * Under the null, each discordant pair is equally likely to favour either side, so the p-value is the
 * two-sided binomial tail with p = 0.5. The exact form is used because discordant counts are often small.
 */
export function mcNemar(paired: readonly PairedOutcome[]): McNemarResult {
  let aOnly = 0;
  let bOnly = 0;
  for (const p of paired) {
    if (p.a && !p.b) aOnly++;
    else if (!p.a && p.b) bOnly++;
  }
  const n = aOnly + bOnly;
  if (n === 0) return { aOnly, bOnly, pValue: 1 };

  const k = Math.min(aOnly, bOnly);
  // log(n!) by cumulative sum keeps the binomial terms finite for large n.
  const logFact = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) logFact[i] = logFact[i - 1]! + Math.log(i);
  const logHalfPow = n * Math.log(0.5);
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    const logChoose = logFact[n]! - logFact[i]! - logFact[n - i]!;
    tail += Math.exp(logChoose + logHalfPow);
  }
  return { aOnly, bOnly, pValue: Math.min(1, 2 * tail) };
}
