/**
 * `@agent-evals/stats` — A/B statistics over scored trials after an experiment completes.
 *
 * `compareConfigs` is the main entry: macro pass rates, bootstrap CIs, McNemar p-value, and a
 * verdict (`a_better` | `b_better` | `likely_noise` | `insufficient_data`). Lower-level helpers
 * (pass rate, bootstrap, McNemar) are exported for tests and custom reports.
 */

export { passRate, wilsonInterval, Z_95 } from './pass-rate.js';
export type { Interval } from './pass-rate.js';
export { bootstrapMeanCI, pairedBootstrapDelta, DEFAULT_ALPHA, DEFAULT_RESAMPLES, DEFAULT_SEED } from './bootstrap.js';
export type { MeanCI, DeltaCI } from './bootstrap.js';
export { mcNemar } from './mcnemar.js';
export type { McNemarResult, PairedOutcome } from './mcnemar.js';
export { compareConfigs, NothingToCompareError } from './compare.js';
export type {
  CompareOptions,
  CompareResult,
  ExcludedCounts,
  ScoredTrial,
  SideInput,
  SideSummary,
  TaskComparison,
  Verdict,
} from './compare.js';
export { mulberry32 } from './rng.js';
