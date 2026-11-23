/**
 * Pure helpers that turn an experiment plan into concrete trial slots.
 *
 * Example: 5 tasks × 2 configs × nTrials=10 → 100 PlannedTrial objects.
 * Each gets a deterministic `seed` (hash of identity) so retries / re-runs of the
 * same cell stay reproducible when the harness/model uses the seed.
 *
 * No I/O here — ExperimentsService.start persists the result as TrialEntity rows.
 */
import { sha256Hex } from '../common/canonical-json.js';
import type { ConfigRef, TaskRef } from '../entities/experiment.entity.js';

/** One cell of the experiment matrix, before it becomes a DB row. */
export interface PlannedTrial {
  taskId: string;
  taskVersion: string;
  configId: string;
  configContentHash: string;
  trialIndex: number;
  seed: number;
}

/**
 * Seed is derived from the trial's identity, so re-running the same planned trial uses the same seed.
 * Fits in a signed 32-bit integer (Postgres int4).
 */
export function seedFor(experimentId: string, taskId: string, configId: string, trialIndex: number): number {
  const digest = sha256Hex(`${experimentId}|${taskId}|${configId}|${trialIndex}`);
  return parseInt(digest.slice(0, 8), 16) >>> 1;
}

/** Expands tasks x configs x nTrials into one planned trial per cell. Order is deterministic. */
export function expandMatrix(
  experimentId: string,
  taskRefs: TaskRef[],
  configRefs: ConfigRef[],
  nTrials: number,
): PlannedTrial[] {
  const planned: PlannedTrial[] = [];
  for (const task of taskRefs) {
    for (const config of configRefs) {
      for (let trialIndex = 0; trialIndex < nTrials; trialIndex++) {
        planned.push({
          taskId: task.id,
          taskVersion: task.version,
          configId: config.id,
          configContentHash: config.contentHash,
          trialIndex,
          seed: seedFor(experimentId, task.id, config.id, trialIndex),
        });
      }
    }
  }
  return planned;
}
