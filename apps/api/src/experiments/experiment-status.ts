import type { EntityManager } from 'typeorm';
import { TrialEntity, type TrialStatus } from '../entities/trial.entity.js';

export type TrialCounts = Record<TrialStatus | 'total', number>;

export type RolledUpStatus = 'running' | 'completed' | 'partial' | 'failed';

export function emptyTrialCounts(): TrialCounts {
  return { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0, timeout: 0, cancelled: 0 };
}

export async function countTrialsByStatus(manager: EntityManager, experimentId: string): Promise<TrialCounts> {
  const rows = await manager
    .createQueryBuilder(TrialEntity, 't')
    .select('t.status', 'status')
    .addSelect('COUNT(*)', 'count')
    .where('t.experimentId = :experimentId', { experimentId })
    .groupBy('t.status')
    .getRawMany<{ status: TrialStatus; count: string }>();

  const counts = emptyTrialCounts();
  for (const row of rows) {
    const n = Number(row.count);
    counts[row.status] = n;
    counts.total += n;
  }
  return counts;
}

/**
 * Experiment status from its trials (implementation.md §11.3–11.4):
 * - running:   some trial is still queued or running
 * - failed:    every trial hit an infrastructure failure
 * - partial:   finished, but some trials failed or timed out or were cancelled
 * - completed: every trial finished and was scored (passing or failing)
 *
 * Agent-scored failures (succeeded with passed=false) do not make an experiment partial.
 */
export function rollupExperimentStatus(c: TrialCounts): RolledUpStatus {
  if (c.queued + c.running > 0) return 'running';
  if (c.total > 0 && c.failed === c.total) return 'failed';
  if (c.failed + c.timeout + c.cancelled > 0) return 'partial';
  return 'completed';
}
