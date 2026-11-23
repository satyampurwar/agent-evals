/**
 * Optional "skills" — bundles of extra tools beyond the core filesystem set.
 *
 * A config lists skill ids in `harness.settings.skillsEnabled`. Each skill maps to one or more
 * tool names (today only `csv_summary`). Skill tools are offered to the model only when enabled,
 * and successful calls emit a `skill_invoke` trace event. Implementations live here; wiring into
 * the tool registry is in `tools.ts`.
 */

import { readFile } from 'node:fs/promises';
import { resolveInSandbox } from '@agent-evals/sandbox';

/**
 * Skills the baseline harness can enable. A config lists skill ids in `harness.settings.skillsEnabled`;
 * each skill exposes one or more tools. Skill tools are only offered when their skill is enabled.
 */
export const SKILL_TOOLS: Readonly<Record<string, readonly string[]>> = {
  csv_summary: ['csv_summary'],
};

export const CSV_OPS = ['sum', 'mean', 'min', 'max', 'count'] as const;
export type CsvOp = (typeof CSV_OPS)[number];

export interface CsvCondition {
  column: string;
  equals: string;
}

export interface CsvSummaryResult {
  path: string;
  column: string;
  op: CsvOp;
  /** Rows that passed every `where` condition (all rows when there are none). */
  rows: number;
  value: number;
}

/**
 * Aggregates one numeric column of a CSV file in the sandbox. `where` keeps only the rows that match
 * every condition (AND).
 *
 * Expects a header row and plain comma-separated values (no quoted fields). Throws on bad input so the
 * caller returns a readable tool error.
 */
export async function csvSummary(
  sandboxDir: string,
  args: { path: string; column: string; op: CsvOp; where?: CsvCondition[] },
): Promise<CsvSummaryResult> {
  if (!(CSV_OPS as readonly string[]).includes(args.op)) {
    throw new Error(`op must be one of ${CSV_OPS.join(', ')}`);
  }
  const abs = await resolveInSandbox(sandboxDir, args.path);
  const text = await readFile(abs, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('csv needs a header row and at least one data row');

  const header = lines[0].split(',').map((h) => h.trim());
  const indexOf = (name: string): number => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`no column named "${name}" (columns: ${header.join(', ')})`);
    return i;
  };
  const valueIndex = indexOf(args.column);
  const conditions = (args.where ?? []).map((c) => ({ index: indexOf(c.column), equals: c.equals }));

  const values: number[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim());
    if (!conditions.every((c) => cells[c.index] === c.equals)) continue;
    if (args.op === 'count') {
      values.push(0);
      continue;
    }
    const raw = cells[valueIndex] ?? '';
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) {
      throw new Error(`column "${args.column}" has a non-numeric value: ${JSON.stringify(raw)}`);
    }
    values.push(n);
  }

  const rows = values.length;
  let value: number;
  if (args.op === 'count') {
    value = rows;
  } else if (rows === 0) {
    throw new Error('no rows matched the filter');
  } else if (args.op === 'sum') {
    value = values.reduce((a, b) => a + b, 0);
  } else if (args.op === 'mean') {
    value = values.reduce((a, b) => a + b, 0) / rows;
  } else if (args.op === 'min') {
    value = Math.min(...values);
  } else {
    value = Math.max(...values);
  }

  return { path: args.path, column: args.column, op: args.op, rows, value };
}
