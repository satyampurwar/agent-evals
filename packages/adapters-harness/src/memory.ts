/**
 * Per-trial key-value memory for the baseline harness.
 *
 * When a config enables memory tools, the runner seeds this store from `task.setup.memory` and
 * passes it into the harness. The agent reads/writes via `memory_read` / `memory_write`. The store
 * is discarded with the trial (unless a future harness persists it — see config
 * `persistAcrossTrials`, unused by baseline today).
 */

import type { MemoryStore } from './types.js';

/** One hit returned by `memory_read`. */
export interface MemoryEntry {
  key: string;
  value: string;
}

/** Lowercased word tokens. "client id" -> ["client", "id"]; "client_id" -> ["client", "id"]. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Per-trial key-value memory. Starts with `seed` (the task's `setup.memory`) and is discarded with the trial.
 *
 * `read(query)` returns every entry whose key and value together contain all query tokens, so
 * "client id" finds the key `client_id`. An empty query returns everything.
 */
export function createTrialMemory(seed: Record<string, string> = {}): MemoryStore {
  const entries = new Map<string, string>(Object.entries(seed));

  return {
    async read(query: string): Promise<unknown[]> {
      const wanted = tokens(query);
      const hits: MemoryEntry[] = [];
      for (const [key, value] of entries) {
        const haystack = tokens(`${key} ${value}`);
        if (wanted.every((w) => haystack.includes(w))) {
          hits.push({ key, value });
        }
      }
      return hits;
    },
    async write(key: string, value: unknown): Promise<void> {
      entries.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
  };
}
