export interface GraderOutcome {
  passed: boolean;
  score: number;
  reasoning: string;
}

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
