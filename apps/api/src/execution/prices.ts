import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PriceTableSchema } from '@agent-evals/domain';
import type { PriceTable } from '@agent-evals/domain';

let cached: PriceTable | undefined;

/**
 * The list-price table (prices.json). PRICE_TABLE_PATH wins. Otherwise the nearest prices.json above the working
 * directory is used: the repo root in development, /app in the image. Read once per process; a missing or invalid
 * file throws, which the executor turns into a setup failure for the trial.
 */
export function loadPriceTable(): PriceTable {
  if (cached) return cached;
  const path = process.env.PRICE_TABLE_PATH ?? findUp('prices.json', process.cwd());
  const parsed = PriceTableSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`invalid price table ${path}: ${parsed.error.issues[0]?.message ?? 'unknown format'}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: forget the cached table so the next call reads the file again. */
export function resetPriceTableCache(): void {
  cached = undefined;
}

function findUp(name: string, start: string): string {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name} not found above ${start}; set PRICE_TABLE_PATH`);
    dir = parent;
  }
}
