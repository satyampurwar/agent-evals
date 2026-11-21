import { describe, expect, it } from 'vitest';
import { createHarness } from './registry';

describe('createHarness', () => {
  it('returns the baseline harness', () => {
    expect(createHarness('baseline').id).toBe('baseline');
  });

  it('rejects unknown harness ids', () => {
    expect(() => createHarness('hermes')).toThrow(/unknown harness "hermes"/);
  });
});
