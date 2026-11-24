import { describe, expect, it } from 'vitest';
import { createHarness, HARNESS_IDS } from './registry';
import { ClaudeAgentHarness } from './claude-agent';
import { HermesHarness } from './hermes';

describe('createHarness', () => {
  it('returns the baseline harness', () => {
    expect(createHarness('baseline').id).toBe('baseline');
  });

  it('returns the Hermes harness', () => {
    const harness = createHarness('hermes');
    expect(harness).toBeInstanceOf(HermesHarness);
    expect(harness.id).toBe('hermes');
  });

  it('returns the Claude Agent SDK harness', () => {
    const harness = createHarness('claude-agent');
    expect(harness).toBeInstanceOf(ClaudeAgentHarness);
    expect(harness.id).toBe('claude-agent');
  });

  it('rejects unknown harness ids and lists the known ones', () => {
    expect(() => createHarness('nope')).toThrow(
      /unknown harness "nope" \(known: baseline, hermes, claude-agent\)/,
    );
    expect(HARNESS_IDS).toEqual(['baseline', 'hermes', 'claude-agent']);
  });
});
