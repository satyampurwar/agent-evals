import { MockModelAdapter } from './mock';
import { OpenRouterAdapter } from './openrouter';
import type { ModelAdapter } from './types';

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
