/**
 * Tiny display formatters for the Vue UI (percentages, money, ids, verdict labels).
 *
 * Missing numbers render as an em dash (—), never as 0, so "not measured" cannot
 * look like a real zero. Verdict helpers pair human text with a CSS tone class.
 */
import type { Verdict } from '@agent-evals/stats';

/** A missing value shows as an em dash, never as 0, so "not measured" cannot read as "zero". */
const MISSING = '—';

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined) return MISSING;
  return `${(x * 100).toFixed(digits)}%`;
}

/** A difference in pass-rate points, signed. 0.75 becomes "+75 pts". */
export function pts(x: number | null | undefined): string {
  if (x === null || x === undefined) return MISSING;
  const v = Math.round(x * 100);
  return `${v > 0 ? '+' : ''}${v} pts`;
}

export function interval(ci: { low: number; high: number } | null | undefined, digits = 2): string {
  if (!ci) return 'n/a';
  return `[${ci.low.toFixed(digits)}, ${ci.high.toFixed(digits)}]`;
}

export function pValue(p: number): string {
  return p < 0.0001 ? '< 0.0001' : p.toFixed(4);
}

export function ms(x: number | null | undefined): string {
  if (x === null || x === undefined) return MISSING;
  return `${Math.round(x)} ms`;
}

export function count(x: number | null | undefined): string {
  if (x === null || x === undefined) return MISSING;
  return String(Math.round(x));
}

export function usd(x: number | null | undefined): string {
  if (x === null || x === undefined) return MISSING;
  return `$${x.toFixed(4)}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function when(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  return new Date(iso).toLocaleString();
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  a_better: 'A is better',
  b_better: 'B is better',
  likely_noise: 'Likely noise',
  insufficient_data: 'Not enough data',
};

export const VERDICT_TONE: Record<Verdict, 'good' | 'bad' | 'noise' | 'muted'> = {
  a_better: 'good',
  b_better: 'bad',
  likely_noise: 'noise',
  insufficient_data: 'muted',
};
