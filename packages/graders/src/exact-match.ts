/**
 * Exact-match grader — compare the agent's final answer string to an expected value.
 *
 * Used when a task has a single correct textual answer (e.g. a number or short phrase).
 * Default normalization trims whitespace and lowercases both sides. Other graders share the
 * `GraderOutcome` shape so the runner can aggregate them uniformly.
 */

/** Common result shape for every grader in this package. */
export interface GraderOutcome {
  passed: boolean;
  score: number;
  reasoning: string;
}

/** Passes when the normalized final answer equals `expected` (score 1 or 0). */
export function exactMatch(
  finalAnswer: string,
  expected: string,
  normalize: 'trim_lower' | undefined = 'trim_lower',
): GraderOutcome {
  const norm = (s: string) => (normalize === 'trim_lower' ? s.trim().toLowerCase() : s);
  const passed = norm(finalAnswer) === norm(expected);
  return {
    passed,
    score: passed ? 1 : 0,
    reasoning: `expected=${expected} got=${finalAnswer}`,
  };
}
