import { describe, expect, it } from 'vitest';
import { PriceTableSchema, UnknownPriceError, costUsd, unpricedModels } from '../pricing.js';
import type { PriceTable } from '../pricing.js';

const table: PriceTable = {
  asOf: '2026-11-21',
  source: 'test',
  models: {
    'openai/gpt-4.1-mini': { inputPerMTok: 0.4, outputPerMTok: 1.6 },
    'anthropic/claude-haiku-4.5': { inputPerMTok: 1, outputPerMTok: 5 },
  },
};

describe('costUsd', () => {
  it('is tokens times list price, per million tokens', () => {
    // 1,000,000 prompt × $0.40 + 1,000,000 completion × $1.60 = $2.00
    expect(costUsd(table, 'openai/gpt-4.1-mini', { promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBeCloseTo(2, 10);
  });

  it('is zero for zero tokens', () => {
    expect(costUsd(table, 'anthropic/claude-haiku-4.5', { promptTokens: 0, completionTokens: 0 })).toBe(0);
  });

  it('prices each model with its own rates', () => {
    const usage = { promptTokens: 2000, completionTokens: 100 };
    expect(costUsd(table, 'openai/gpt-4.1-mini', usage)).toBeCloseTo((2000 * 0.4 + 100 * 1.6) / 1e6, 12);
    expect(costUsd(table, 'anthropic/claude-haiku-4.5', usage)).toBeCloseTo((2000 * 1 + 100 * 5) / 1e6, 12);
  });

  it('throws UnknownPriceError for a model the table does not price', () => {
    expect(() => costUsd(table, 'meta/llama', { promptTokens: 1, completionTokens: 1 })).toThrow(UnknownPriceError);
  });
});

describe('unpricedModels', () => {
  it('returns the ids the table cannot price, once each', () => {
    expect(unpricedModels(table, ['openai/gpt-4.1-mini', 'meta/llama', 'meta/llama'])).toEqual(['meta/llama']);
  });

  it('is empty when every model is priced', () => {
    expect(unpricedModels(table, ['openai/gpt-4.1-mini'])).toEqual([]);
  });
});

describe('PriceTableSchema', () => {
  it('accepts a well-formed table', () => {
    expect(PriceTableSchema.parse(table).models['openai/gpt-4.1-mini'].outputPerMTok).toBe(1.6);
  });

  it('rejects negative prices', () => {
    const bad = { ...table, models: { x: { inputPerMTok: -1, outputPerMTok: 1 } } };
    expect(PriceTableSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a table with no models key', () => {
    expect(PriceTableSchema.safeParse({ asOf: 'x', source: 'y' }).success).toBe(false);
  });
});
