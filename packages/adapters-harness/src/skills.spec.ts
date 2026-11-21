import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { csvSummary } from './skills';

let dir: string;

const CSV = [
  'region,status,amount',
  'north,paid,10',
  'north,open,99',
  'south,paid,5',
  'north,paid,20',
  'south,paid,7',
].join('\n');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'csv-skill-'));
  await writeFile(join(dir, 'sales.csv'), CSV);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('csvSummary', () => {
  it('sums a column over all rows', async () => {
    const r = await csvSummary(dir, { path: 'sales.csv', column: 'amount', op: 'sum' });
    expect(r).toMatchObject({ rows: 5, value: 10 + 99 + 5 + 20 + 7 });
  });

  it('applies the equality filter before aggregating', async () => {
    const r = await csvSummary(dir, {
      path: 'sales.csv',
      column: 'amount',
      op: 'sum',
      where: [{ column: 'region', equals: 'north' }],
    });
    expect(r).toMatchObject({ rows: 3, value: 10 + 99 + 20 });
  });

  it('computes mean, min, max, and count', async () => {
    const where = [{ column: 'status', equals: 'paid' }];
    expect(await csvSummary(dir, { path: 'sales.csv', column: 'amount', op: 'mean', where })).toMatchObject({
      rows: 4,
      value: (10 + 5 + 20 + 7) / 4,
    });
    expect(await csvSummary(dir, { path: 'sales.csv', column: 'amount', op: 'min', where })).toMatchObject({ value: 5 });
    expect(await csvSummary(dir, { path: 'sales.csv', column: 'amount', op: 'max', where })).toMatchObject({ value: 20 });
    expect(await csvSummary(dir, { path: 'sales.csv', column: 'amount', op: 'count', where })).toMatchObject({ value: 4 });
  });

  it('keeps only rows that match every condition (AND)', async () => {
    const r = await csvSummary(dir, {
      path: 'sales.csv',
      column: 'amount',
      op: 'sum',
      where: [
        { column: 'region', equals: 'north' },
        { column: 'status', equals: 'paid' },
      ],
    });
    expect(r).toMatchObject({ rows: 2, value: 10 + 20 });
  });

  it('rejects an unknown column with the available columns in the message', async () => {
    await expect(csvSummary(dir, { path: 'sales.csv', column: 'price', op: 'sum' })).rejects.toThrow(
      /no column named "price".*region, status, amount/,
    );
  });

  it('rejects a non-numeric value in the aggregated column', async () => {
    await writeFile(join(dir, 'bad.csv'), 'amount\n1\nabc\n');
    await expect(csvSummary(dir, { path: 'bad.csv', column: 'amount', op: 'sum' })).rejects.toThrow(/non-numeric/);
  });

  it('rejects a filter that matches no rows for a value aggregate', async () => {
    await expect(
      csvSummary(dir, { path: 'sales.csv', column: 'amount', op: 'sum', where: [{ column: 'region', equals: 'west' }] }),
    ).rejects.toThrow(/no rows matched/);
  });

  it('refuses paths outside the sandbox', async () => {
    await expect(csvSummary(dir, { path: '../sales.csv', column: 'amount', op: 'sum' })).rejects.toThrow();
  });
});
