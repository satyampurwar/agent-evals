/**
 * A/B comparison of two agent configs on the same tasks.
 *
 * After an experiment finishes, this module turns scored trials into a verdict: is config A better,
 * B better, or is the difference likely noise? Analysis is **task-first** (macro pass rates and a
 * paired bootstrap CI over tasks) because multiple trials of one task are not independent. McNemar
 * supplies a p-value on paired trials; the published verdict follows the delta confidence interval.
 *
 * High-level outputs of `compareConfigs`:
 * - macro pass rate per side + bootstrap CIs / paired delta
 * - McNemar on paired (task, trialIndex) outcomes
 * - per-task deltas and a coarse verdict (a_better / b_better / likely_noise / …)
 * - mean latency, tokens, cost beside the quality numbers
 *
 * Infra failures (`failed` / `cancelled` / `pending`) are excluded from pass rates.
 * Pure functions — ExperimentsService adapts DB rows then calls into this package.
 */
import { bootstrapMeanCI, pairedBootstrapDelta, DEFAULT_ALPHA, DEFAULT_RESAMPLES, DEFAULT_SEED } from './bootstrap.js';
import { mcNemar } from './mcnemar.js';
import { passRate, type Interval } from './pass-rate.js';

/** A trial that reached a verdict: the agent finished (or timed out) and the graders ran or the budget ran out. */
export interface ScoredTrial {
  taskId: string;
  trialIndex: number;
  passed: boolean;
  metrics?: {
    latencyMs: number;
    totalTokens: number;
    /** Optional: absent for trials recorded before cost metering (Phase 15). Estimated at list price, see COST.md. */
    estimatedCostUsd?: number;
  };
}

/** Trials that did not reach a verdict. They are counted and reported, never scored. */
export interface ExcludedCounts {
  /** Infrastructure failure: model error, sandbox error, setup error. */
  failed: number;
  cancelled: number;
  /** Still queued or running. */
  pending: number;
}

export interface SideInput {
  configId: string;
  trials: ScoredTrial[];
  excluded: ExcludedCounts;
}

export interface CompareOptions {
  resamples?: number;
  alpha?: number;
  seed?: number;
}

/** Thrown when no task has a scored trial on both configs, so there is nothing paired to compare. */
export class NothingToCompareError extends Error {
  constructor() {
    super('no task has a scored trial for both configs');
    this.name = 'NothingToCompareError';
  }
}

export interface SideSummary {
  configId: string;
  /** Scored trials on this side, across all its tasks. */
  scoredTrials: number;
  /** Macro pass rate: each common task counts once, however many trials it has. */
  passRate: number;
  /** Bootstrap CI over the per-task pass rates, so it reflects task-to-task variation. */
  passRateCI: Interval;
  /** Means over all scored trials on this side that have metrics. Null when none do. */
  meanLatencyMs: number | null;
  meanTotalTokens: number | null;
  meanCostUsd: number | null;
  excluded: ExcludedCounts;
}

export interface TaskComparison {
  taskId: string;
  trialsA: number;
  trialsB: number;
  passRateA: number;
  passRateB: number;
  /** passRateA - passRateB. Positive means A did better on this task. */
  delta: number;
}

export type Verdict = 'a_better' | 'b_better' | 'likely_noise' | 'insufficient_data';

export interface CompareResult {
  /** Tasks with at least one scored trial on both sides. The macro numbers and the delta use these only. */
  commonTasks: number;
  /** (task, trialIndex) pairs scored on both sides. McNemar uses these. */
  pairedTrials: number;
  a: SideSummary;
  b: SideSummary;
  delta: {
    /** Macro pass rate of A minus B. */
    value: number;
    /** Paired bootstrap CI over tasks. Null when fewer than 2 common tasks. */
    ci: Interval | null;
    /** Exact McNemar p-value on the paired trials. */
    pValue: number;
    discordant: { aOnly: number; bOnly: number };
  };
  /** True when the delta CI includes 0, or when there is too little data to tell. */
  noise: boolean;
  verdict: Verdict;
  perTask: TaskComparison[];
  notes: string[];
}

function indexByTask(trials: readonly ScoredTrial[], label: string): Map<string, Map<number, ScoredTrial>> {
  const byTask = new Map<string, Map<number, ScoredTrial>>();
  for (const t of trials) {
    let byIndex = byTask.get(t.taskId);
    if (!byIndex) {
      byIndex = new Map();
      byTask.set(t.taskId, byIndex);
    }
    if (byIndex.has(t.trialIndex)) {
      throw new RangeError(`${label}: duplicate trial ${t.taskId}#${t.trialIndex}`);
    }
    byIndex.set(t.trialIndex, t);
  }
  return byTask;
}

function meanOrNull(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, x) => s + x, 0) / values.length;
}

function sideSummary(side: SideInput, commonRates: number[], B: number, alpha: number, seed: number): SideSummary {
  const latency: number[] = [];
  const tokens: number[] = [];
  const cost: number[] = [];
  for (const t of side.trials) {
    if (!t.metrics) continue;
    latency.push(t.metrics.latencyMs);
    tokens.push(t.metrics.totalTokens);
    if (t.metrics.estimatedCostUsd !== undefined) cost.push(t.metrics.estimatedCostUsd);
  }
  return {
    configId: side.configId,
    scoredTrials: side.trials.length,
    passRate: passRate(commonRates),
    passRateCI: bootstrapMeanCI(commonRates, B, alpha, seed),
    meanLatencyMs: meanOrNull(latency),
    meanTotalTokens: meanOrNull(tokens),
    meanCostUsd: meanOrNull(cost),
    excluded: side.excluded,
  };
}

/**
 * Compares two configs on the same tasks. The unit of analysis is the task, not the trial: trials of
 * one task are not independent, so the macro rates and the delta CI resample tasks. McNemar is run on
 * paired trials for the p-value, which treats trials as independent. That makes it optimistic when
 * trials cluster by task. The verdict uses the CI, not the p-value.
 */
export function compareConfigs(a: SideInput, b: SideInput, options: CompareOptions = {}): CompareResult {
  const B = options.resamples ?? DEFAULT_RESAMPLES;
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const seed = options.seed ?? DEFAULT_SEED;

  const byTaskA = indexByTask(a.trials, 'a');
  const byTaskB = indexByTask(b.trials, 'b');
  const common = [...byTaskA.keys()].filter((t) => byTaskB.has(t)).sort();
  if (common.length === 0) throw new NothingToCompareError();

  const perTask: TaskComparison[] = common.map((taskId) => {
    const ta = [...byTaskA.get(taskId)!.values()];
    const tb = [...byTaskB.get(taskId)!.values()];
    const passRateA = passRate(ta.map((t) => (t.passed ? 1 : 0)));
    const passRateB = passRate(tb.map((t) => (t.passed ? 1 : 0)));
    return {
      taskId,
      trialsA: ta.length,
      trialsB: tb.length,
      passRateA,
      passRateB,
      delta: passRateA - passRateB,
    };
  });

  const ratesA = perTask.map((t) => t.passRateA);
  const ratesB = perTask.map((t) => t.passRateB);

  const pairs: { a: boolean; b: boolean }[] = [];
  for (const taskId of common) {
    const tb = byTaskB.get(taskId)!;
    for (const [index, ta] of byTaskA.get(taskId)!) {
      const tbTrial = tb.get(index);
      if (tbTrial) pairs.push({ a: ta.passed, b: tbTrial.passed });
    }
  }
  const mc = mcNemar(pairs);

  const notes: string[] = [];
  const sideA = sideSummary(a, ratesA, B, alpha, seed);
  const sideB = sideSummary(b, ratesB, B, alpha, seed);
  const excludedTotal = (s: ExcludedCounts) => s.failed + s.cancelled + s.pending;
  if (excludedTotal(a.excluded) > 0 || excludedTotal(b.excluded) > 0) {
    notes.push(
      `excluded trials: A failed ${a.excluded.failed}, cancelled ${a.excluded.cancelled}, pending ${a.excluded.pending}; ` +
        `B failed ${b.excluded.failed}, cancelled ${b.excluded.cancelled}, pending ${b.excluded.pending}`,
    );
  }
  const value = sideA.passRate - sideB.passRate;

  if (common.length < 2) {
    notes.push('need at least 2 tasks with scored trials on both configs; the delta interval is not computed');
    return {
      commonTasks: common.length,
      pairedTrials: pairs.length,
      a: sideA,
      b: sideB,
      delta: { value, ci: null, pValue: mc.pValue, discordant: { aOnly: mc.aOnly, bOnly: mc.bOnly } },
      noise: true,
      verdict: 'insufficient_data',
      perTask,
      notes,
    };
  }

  const deltaCi = pairedBootstrapDelta(ratesA, ratesB, B, alpha, seed);
  const ci: Interval = { low: deltaCi.low, high: deltaCi.high };
  const noise = ci.low <= 0 && ci.high >= 0;
  const verdict: Verdict = noise ? 'likely_noise' : value > 0 ? 'a_better' : 'b_better';

  return {
    commonTasks: common.length,
    pairedTrials: pairs.length,
    a: sideA,
    b: sideB,
    delta: { value, ci, pValue: mc.pValue, discordant: { aOnly: mc.aOnly, bOnly: mc.bOnly } },
    noise,
    verdict,
    perTask,
    notes,
  };
}
