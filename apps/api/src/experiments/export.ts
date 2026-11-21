import type { Experiment } from '@agent-evals/domain';
import type { TrialView } from '../trials/trials.service.js';

/** The config fields an export needs to say which model and harness produced each trial. */
export interface ExportConfig {
  id: string;
  name: string;
  version: number;
  contentHash: string;
  harnessId: string;
  provider: string;
  modelId: string;
  temperature: number;
  topP?: number;
}

export interface ExperimentExport {
  experiment: Experiment;
  configs: ExportConfig[];
  trials: TrialView[];
}

/**
 * CSV columns, in order. Every trial row carries its config's name, harness and model, so a CSV
 * that mixes two configs (for example two models) can be filtered without the JSON.
 */
export const TRIAL_EXPORT_COLUMNS = [
  'experimentId',
  'taskId',
  'taskVersion',
  'configId',
  'configName',
  'harnessId',
  'modelId',
  'trialIndex',
  'status',
  'passed',
  'score',
  'latencyMs',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'stepCount',
  'estimatedCostUsd',
  'errorCode',
  'errorMessage',
  'startedAt',
  'finishedAt',
] as const;

/**
 * Escapes one CSV cell. Quotes fields that hold commas, quotes or newlines. Prefixes text that
 * starts with = + - @ with an apostrophe, so a spreadsheet treats it as text, not as a formula.
 * Same rule as the web app's CSV export (apps/web/src/lib/csv.ts).
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') {
    s = /^[=+\-@]/.test(value) ? `'${value}` : value;
  } else {
    s = typeof value === 'object' ? JSON.stringify(value) : String(value as number | boolean | bigint);
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** One CSV row per trial. A trial whose config is missing from the export gets blank config columns. */
export function trialExportRows(
  trials: readonly TrialView[],
  configs: readonly ExportConfig[],
): Record<string, unknown>[] {
  const byId = new Map(configs.map((c) => [c.id, c]));
  return trials.map((t) => {
    const config = byId.get(t.configId);
    return {
      experimentId: t.experimentId,
      taskId: t.taskId,
      taskVersion: t.taskVersion,
      configId: t.configId,
      configName: config?.name,
      harnessId: config?.harnessId,
      modelId: config?.modelId,
      trialIndex: t.trialIndex,
      status: t.status,
      passed: t.passed,
      score: t.score,
      latencyMs: t.metrics.latencyMs,
      promptTokens: t.metrics.promptTokens,
      completionTokens: t.metrics.completionTokens,
      totalTokens: t.metrics.totalTokens,
      stepCount: t.metrics.stepCount,
      estimatedCostUsd: t.metrics.estimatedCostUsd,
      errorCode: t.error?.code,
      errorMessage: t.error?.message,
      startedAt: isoOrUndefined(t.startedAt),
      finishedAt: isoOrUndefined(t.finishedAt),
    };
  });
}

/** Dates come from the database as Date objects. Write them as ISO text, or csvEscape would JSON-quote them. */
function isoOrUndefined(value: Date | null): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

export function experimentToCsv(data: ExperimentExport): string {
  return toCsv(TRIAL_EXPORT_COLUMNS, trialExportRows(data.trials, data.configs));
}
