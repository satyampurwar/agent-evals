import type { TrialView } from '../api/endpoints';

export type Outcome = 'passed' | 'failed' | 'timeout' | 'infra' | 'cancelled' | 'pending';

/**
 * What happened to a trial, in the terms of EXECUTION_PLAN §7.8. A scored failure (the agent answered
 * wrong) is different from an infrastructure failure (the trial never got an answer).
 */
export function outcomeOf(trial: Pick<TrialView, 'status' | 'passed'>): Outcome {
  switch (trial.status) {
    case 'succeeded':
      return trial.passed === true ? 'passed' : 'failed';
    case 'timeout':
      return 'timeout';
    case 'failed':
      return 'infra';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export const OUTCOME_TEXT: Record<Outcome, string> = {
  passed: 'Passed',
  failed: 'Failed (scored)',
  timeout: 'Timed out',
  infra: 'Infrastructure failure',
  cancelled: 'Cancelled',
  pending: 'Pending',
};

export function isScored(trial: Pick<TrialView, 'status'>): boolean {
  return trial.status === 'succeeded' || trial.status === 'timeout';
}
