/**
 * `@agent-evals/stats` — compare two configs after an experiment finishes.
 *
 * Main entry: `compareConfigs` → macro pass rates, paired bootstrap CI, McNemar,
 * per-task deltas, verdict (`a_better` | `b_better` | `likely_noise` | `insufficient_data`).
 * Also `analyzeFailures` for coarse failure buckets. Used by the API compare/failures routes.
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
export { analyzeFailures, classifyFailure } from './failures.js';
export type {
  FailureAnalysis,
  FailureCategory,
  FailureCategoryCount,
  FailureTrialInput,
} from './failures.js';
export { mulberry32 } from './rng.js';
