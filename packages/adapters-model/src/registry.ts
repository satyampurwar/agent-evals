/**
 * Factory for model adapters by provider name.
 *
 * Configs store `model.provider` (e.g. `"openrouter"`). Callers pass that string here instead of
 * constructing adapters themselves — a classic factory pattern so adding a provider is one switch
 * case, and API keys stay in the environment rather than in config JSON.
 */

import { MockModelAdapter } from './mock.js';
import { OpenRouterAdapter } from './openrouter.js';
import type { ModelAdapter } from './types.js';

/** Parsed `"provider:modelId"` string used by CLIs and some configs. */
export interface ModelSpec {
  provider: string;
  modelId: string;
}

/** "openrouter:openai/gpt-4.1-mini" -> { provider: "openrouter", modelId: "openai/gpt-4.1-mini" } */
export function parseModelSpec(spec: string): ModelSpec {
  const i = spec.indexOf(':');
  if (i <= 0 || i === spec.length - 1) {
    throw new Error(`model spec must look like "provider:modelId", got "${spec}"`);
  }
  return { provider: spec.slice(0, i), modelId: spec.slice(i + 1) };
}

/** Builds a model adapter for a provider name. Reads API keys from `env`, never from literals. */
export function createModelAdapter(
  provider: string,
  env: Record<string, string | undefined> = process.env,
): ModelAdapter {
  switch (provider) {
    case 'openrouter':
      return new OpenRouterAdapter({ apiKey: env.OPENROUTER_API_KEY ?? '' });
    case 'mock':
      return new MockModelAdapter('42');
    default:
      throw new Error(`unknown model provider "${provider}" (known: openrouter, mock)`);
  }
}
