/**
 * Adapts DB trial rows into the shape `@agent-evals/stats` expects for A/B compare.
 *
 * Stats package is pure (no Nest/TypeORM). ExperimentsService loads rows, maps each
 * config through `toSideInput`, then calls `compareConfigs(a, b)`.
 */
import type { ScoredTrial, SideInput } from '@agent-evals/stats';

/** The columns of a trial row that the comparison reads. */
export interface TrialRowForCompare {
  taskId: string;
  trialIndex: number;
  configId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  passed: boolean | null;
  metrics: {
    latencyMs?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
}

/**
 * Splits one config's trials into scored trials (the agent finished, or hit its time budget) and
 * excluded counts. A timeout is scored as a fail: the config did not finish within its budget.
 * Infrastructure failures and cancellations are excluded, so they cannot lower a config's pass rate.
 */
export function toSideInput(configId: string, rows: readonly TrialRowForCompare[]): SideInput {
  const excluded = { failed: 0, cancelled: 0, pending: 0 };
  const trials: ScoredTrial[] = [];
  for (const row of rows) {
    switch (row.status) {
      case 'succeeded':
      case 'timeout': {
        const m = row.metrics;
        // Cost is optional: trials recorded before Phase 15 have no estimatedCostUsd.
        // Latency and tokens are required for a trial to count toward those means.
        const hasMetrics = m.latencyMs !== undefined && m.totalTokens !== undefined;
        trials.push({
          taskId: row.taskId,
          trialIndex: row.trialIndex,
          passed: row.status === 'succeeded' && row.passed === true,
          ...(hasMetrics
            ? {
                metrics: {
                  latencyMs: m.latencyMs!,
                  totalTokens: m.totalTokens!,
                  ...(m.estimatedCostUsd !== undefined ? { estimatedCostUsd: m.estimatedCostUsd } : {}),
                },
              }
            : {}),
        });
        break;
      }
      case 'failed':
        excluded.failed++;
        break;
      case 'cancelled':
        excluded.cancelled++;
        break;
      default:
        excluded.pending++;
    }
  }
  return { configId, trials, excluded };
}
