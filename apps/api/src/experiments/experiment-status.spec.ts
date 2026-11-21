import { describe, expect, it } from 'vitest';
import { emptyTrialCounts, rollupExperimentStatus, type TrialCounts } from './experiment-status.js';

function counts(partial: Partial<Omit<TrialCounts, 'total'>>): TrialCounts {
  const c = { ...emptyTrialCounts(), ...partial };
  c.total = c.queued + c.running + c.succeeded + c.failed + c.timeout + c.cancelled;
  return c;
}

describe('rollupExperimentStatus', () => {
  it('stays running while any trial is queued or running', () => {
    expect(rollupExperimentStatus(counts({ queued: 3, succeeded: 2 }))).toBe('running');
    expect(rollupExperimentStatus(counts({ running: 1, timeout: 4 }))).toBe('running');
  });

  it('is completed when all trials are scored, including agent failures', () => {
    expect(rollupExperimentStatus(counts({ succeeded: 5 }))).toBe('completed');
  });

  it('is partial when some trials timed out, even if the rest succeeded', () => {
    expect(rollupExperimentStatus(counts({ succeeded: 3, timeout: 3 }))).toBe('partial');
  });

  it('is partial when some trials had infrastructure failures', () => {
    expect(rollupExperimentStatus(counts({ succeeded: 4, failed: 1 }))).toBe('partial');
  });

  it('is failed only when every trial had an infrastructure failure', () => {
    expect(rollupExperimentStatus(counts({ failed: 5 }))).toBe('failed');
  });

  it('is partial when some trials were cancelled', () => {
    expect(rollupExperimentStatus(counts({ succeeded: 2, cancelled: 1 }))).toBe('partial');
  });
});
