/**
 * Factory for harness adapters by id (`baseline` | `hermes`).
 *
 * Configs and CLIs pass a string; this switch constructs the matching `HarnessAdapter` so the
 * runner does not import concrete classes. Same factory pattern as `createModelAdapter`.
 */

import { BaselineHarness } from './baseline.js';
import { HermesHarness } from './hermes.js';
import type { HarnessAdapter } from './types.js';

/** Harness ids accepted by `--harness` and by a config's `harness.id`. */
export const HARNESS_IDS = ['baseline', 'hermes'] as const;

/** Builds the harness named by `id`, or throws if unknown. */
export function createHarness(id: string): HarnessAdapter {
  switch (id) {
    case 'baseline':
      return new BaselineHarness();
    case 'hermes':
      return new HermesHarness();
    default:
      throw new Error(`unknown harness "${id}" (known: ${HARNESS_IDS.join(', ')})`);
  }
}
