/**
 * `@agent-evals/runner` — executes a single trial end-to-end (sandbox → harness → graders → cleanup).
 * The API / BullMQ worker layer builds `RunTrialInput` and persists the returned result; this package
 * owns the trial lifecycle itself.
 */

export { runTrial, RunnerError } from './run-trial.js';
export type {
  RunTrialInput,
  RunTrialResult,
  TrialBudgets,
  TrialError,
  TrialStatus,
} from './run-trial.js';
