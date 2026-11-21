import { BaselineHarness } from './baseline';
import type { HarnessAdapter } from './types';

/** Harness ids accepted by `--harness`. */
export const HARNESS_IDS = ['baseline'] as const;

export function createHarness(id: string): HarnessAdapter {
  switch (id) {
    case 'baseline':
      return new BaselineHarness();
    default:
      throw new Error(`unknown harness "${id}" (known: ${HARNESS_IDS.join(', ')})`);
  }
}
