import { z } from 'zod';

/**
 * Cost metering helpers for agent-evals trials.
 *
 * After a trial (and any `llm_judge` calls), the runner converts token usage into an
 * `estimatedCostUsd` using list prices. That number is stored on the trial metrics and used in
 * A/B cost summaries — it is an estimate for comparison, not a provider invoice.
 *
 * List prices for the models the platform meters, in USD per million tokens. The table lives in prices.json at
 * the repo root (PRICE_TABLE_PATH overrides it). The estimate uses list prices only: it does not apply prompt-cache
 * discounts, so it overstates the provider's bill when cache hits happen (see COST.md).
 */
export const PriceEntrySchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
});

export const PriceTableSchema = z.object({
  asOf: z.string(),
  source: z.string(),
  models: z.record(z.string(), PriceEntrySchema),
});

export type PriceEntry = z.infer<typeof PriceEntrySchema>;
export type PriceTable = z.infer<typeof PriceTableSchema>;

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/** Thrown when a model has no price. The runner checks for this before a trial spends anything. */
export class UnknownPriceError extends Error {
  constructor(readonly modelId: string) {
    super(`no price for model "${modelId}" in the price table`);
    this.name = 'UnknownPriceError';
  }
}

/** Estimated cost of one call or sum of calls: tokens × list price. Throws UnknownPriceError for an unpriced model. */
export function costUsd(table: PriceTable, modelId: string, usage: TokenUsage): number {
  const price = table.models[modelId];
  if (!price) throw new UnknownPriceError(modelId);
  return (usage.promptTokens * price.inputPerMTok + usage.completionTokens * price.outputPerMTok) / 1_000_000;
}

/** Model ids in `modelIds` that the table cannot price. Empty when every model is priced. */
export function unpricedModels(table: PriceTable, modelIds: readonly string[]): string[] {
  return [...new Set(modelIds)].filter((id) => !table.models[id]);
}
