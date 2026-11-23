/**
 * Coarse failure categories for experiment trials (`GET /experiments/:id/failures`).
 *
 * Built from status, stop reason, grade, and optional tool-call hints. Heuristic only —
 * enough to group regressions (wrong tool, budget exhaustion, grader fail, …), not a
 * full root-cause engine.
 */

export type FailureCategory =
  | 'infra_error'
  | 'timeout'
  | 'step_exhaustion'
  | 'token_exhaustion'
  | 'wrong_tool'
  | 'hallucinated_tool_args'
  | 'gave_up_early'
  | 'grader_fail'
  | 'grader_disagreement'
  | 'other';

export interface FailureTrialInput {
  trialId: string;
  taskId: string;
  configId: string;
  trialIndex: number;
  status: string;
  passed: boolean | null;
  stoppedReason?: string | null;
  errorCode?: string | null;
  /** True when any grader failed while another passed (multi-grader disagreement). */
  graderDisagreement?: boolean;
  /** Trace event types / tool names when available (optional). */
  toolCalls?: readonly { name: string; ok: boolean; error?: string }[];
  finalAnswer?: string;
}

export interface FailureCategoryCount {
  category: FailureCategory;
  count: number;
  examples: string[];
}

export interface FailureAnalysis {
  totalFailed: number;
  byCategory: FailureCategoryCount[];
  notes: string[];
}

const EXAMPLE_CAP = 5;

/** Classify one failed (or infra-failed) trial. Passing trials return null. */
export function classifyFailure(t: FailureTrialInput): FailureCategory | null {
  if (t.status === 'failed' || t.status === 'cancelled') return 'infra_error';
  if (t.status === 'timeout' || t.stoppedReason === 'timeout') return 'timeout';
  if (t.status === 'queued' || t.status === 'running') return null;
  if (t.passed === true) return null;

  // Scored failure (succeeded or budget stop that still ran graders).
  if (t.graderDisagreement) return 'grader_disagreement';
  if (t.stoppedReason === 'max_steps') return 'step_exhaustion';
  if (t.stoppedReason === 'max_tokens') return 'token_exhaustion';

  const tools = t.toolCalls ?? [];
  if (tools.some((c) => /unknown tool|not (allowed|in allowlist)/i.test(c.error ?? ''))) {
    return 'wrong_tool';
  }
  if (tools.some((c) => !c.ok && /invalid|schema|argument|required/i.test(c.error ?? ''))) {
    return 'hallucinated_tool_args';
  }

  const answer = (t.finalAnswer ?? '').trim();
  if (t.stoppedReason === 'completed' && answer.length === 0) return 'gave_up_early';
  if (t.stoppedReason === 'completed' || t.stoppedReason == null) return 'grader_fail';
  return 'other';
}

/** Aggregate failed trials into category counts with a few example trial ids each. */
export function analyzeFailures(trials: readonly FailureTrialInput[]): FailureAnalysis {
  const buckets = new Map<FailureCategory, { count: number; examples: string[] }>();
  let totalFailed = 0;

  for (const t of trials) {
    const cat = classifyFailure(t);
    if (!cat) continue;
    totalFailed += 1;
    let bucket = buckets.get(cat);
    if (!bucket) {
      bucket = { count: 0, examples: [] };
      buckets.set(cat, bucket);
    }
    bucket.count += 1;
    if (bucket.examples.length < EXAMPLE_CAP) bucket.examples.push(t.trialId);
  }

  const order: FailureCategory[] = [
    'infra_error',
    'timeout',
    'step_exhaustion',
    'token_exhaustion',
    'wrong_tool',
    'hallucinated_tool_args',
    'gave_up_early',
    'grader_fail',
    'grader_disagreement',
    'other',
  ];

  const byCategory: FailureCategoryCount[] = order
    .filter((c) => buckets.has(c))
    .map((category) => {
      const b = buckets.get(category)!;
      return { category, count: b.count, examples: b.examples };
    });

  const notes: string[] = [
    'Categories are heuristic from status, stop reason, and optional tool errors.',
    'Budget stops (max_steps / max_tokens) with a failed grade are counted as exhaustion, not grader_fail.',
  ];

  return { totalFailed, byCategory, notes };
}
