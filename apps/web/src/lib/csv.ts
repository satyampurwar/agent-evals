import type { TrialView } from '../api/endpoints';

/**
 * Escapes one CSV cell. Quotes fields that hold commas, quotes or newlines. Prefixes text that
 * starts with = + - @ with an apostrophe, so a spreadsheet treats it as text, not as a formula.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') {
    s = /^[=+\-@]/.test(value) ? `'${value}` : value;
  } else {
    s = typeof value === 'object' ? JSON.stringify(value) : String(value);
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

export const TRIAL_CSV_COLUMNS = [
  'experimentId',
  'taskId',
  'taskVersion',
  'configId',
  'trialIndex',
  'status',
  'passed',
  'score',
  'latencyMs',
  'totalTokens',
  'estimatedCostUsd',
  'errorCode',
  'errorMessage',
  'startedAt',
  'finishedAt',
] as const;

export function trialCsvRows(trials: readonly TrialView[]): Record<string, unknown>[] {
  return trials.map((t) => ({
    experimentId: t.experimentId,
    taskId: t.taskId,
    taskVersion: t.taskVersion,
    configId: t.configId,
    trialIndex: t.trialIndex,
    status: t.status,
    passed: t.passed,
    score: t.score,
    latencyMs: t.metrics.latencyMs,
    totalTokens: t.metrics.totalTokens,
    estimatedCostUsd: t.metrics.estimatedCostUsd,
    errorCode: t.error?.code,
    errorMessage: t.error?.message,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
  }));
}
