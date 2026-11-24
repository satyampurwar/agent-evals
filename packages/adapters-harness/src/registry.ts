/**
 * Factory for harness adapters by id (`baseline` | `hermes` | `claude-agent`).
 *
 * Configs and CLIs pass a string; this switch constructs the matching `HarnessAdapter` so the
 * runner does not import concrete classes. Same factory pattern as `createModelAdapter`.
 */

import { BaselineHarness } from './baseline.js';
import { ClaudeAgentHarness } from './claude-agent.js';
import { HermesHarness } from './hermes.js';
import type { HarnessAdapter } from './types.js';

/** Harness ids accepted by `--harness` and by a config's `harness.id`. */
export const HARNESS_IDS = ['baseline', 'hermes', 'claude-agent'] as const;

/** Builds the harness named by `id`, or throws if unknown. */
export function createHarness(id: string): HarnessAdapter {
  switch (id) {
    case 'baseline':
      return new BaselineHarness();
    case 'hermes':
      return new HermesHarness();
    case 'claude-agent':
      return new ClaudeAgentHarness();
    default:
      throw new Error(`unknown harness "${id}" (known: ${HARNESS_IDS.join(', ')})`);
  }
}
