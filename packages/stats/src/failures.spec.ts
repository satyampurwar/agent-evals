import { describe, expect, it } from 'vitest';
import { analyzeFailures, classifyFailure } from './failures.js';

describe('classifyFailure', () => {
  it('maps infra and timeout', () => {
    expect(classifyFailure({ trialId: '1', taskId: 't', configId: 'c', trialIndex: 0, status: 'failed', passed: false })).toBe(
      'infra_error',
    );
    expect(
      classifyFailure({
        trialId: '1',
        taskId: 't',
        configId: 'c',
        trialIndex: 0,
        status: 'timeout',
        passed: false,
        stoppedReason: 'timeout',
      }),
    ).toBe('timeout');
  });

  it('maps budget stops and completed grader fails', () => {
    expect(
      classifyFailure({
        trialId: '1',
        taskId: 't',
        configId: 'c',
        trialIndex: 0,
        status: 'succeeded',
        passed: false,
        stoppedReason: 'max_steps',
      }),
    ).toBe('step_exhaustion');
    expect(
      classifyFailure({
        trialId: '1',
        taskId: 't',
        configId: 'c',
        trialIndex: 0,
        status: 'succeeded',
        passed: false,
        stoppedReason: 'completed',
        finalAnswer: 'wrong',
      }),
    ).toBe('grader_fail');
  });

  it('detects wrong tool from trace errors', () => {
    expect(
      classifyFailure({
        trialId: '1',
        taskId: 't',
        configId: 'c',
        trialIndex: 0,
        status: 'succeeded',
        passed: false,
        stoppedReason: 'completed',
        toolCalls: [{ name: 'explode', ok: false, error: 'unknown tool explode' }],
      }),
    ).toBe('wrong_tool');
  });

  it('ignores passing trials', () => {
    expect(
      classifyFailure({
        trialId: '1',
        taskId: 't',
        configId: 'c',
        trialIndex: 0,
        status: 'succeeded',
        passed: true,
        stoppedReason: 'completed',
      }),
    ).toBeNull();
  });
});

describe('analyzeFailures', () => {
  it('groups and caps examples', () => {
    const r = analyzeFailures([
      { trialId: 'a', taskId: 't', configId: 'c', trialIndex: 0, status: 'failed', passed: false },
      { trialId: 'b', taskId: 't', configId: 'c', trialIndex: 1, status: 'failed', passed: false },
      {
        trialId: 'c',
        taskId: 't',
        configId: 'c',
        trialIndex: 2,
        status: 'succeeded',
        passed: false,
        stoppedReason: 'max_tokens',
      },
    ]);
    expect(r.totalFailed).toBe(3);
    expect(r.byCategory.find((x) => x.category === 'infra_error')?.count).toBe(2);
    expect(r.byCategory.find((x) => x.category === 'token_exhaustion')?.count).toBe(1);
  });
});
