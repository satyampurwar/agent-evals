/**
 * Offline stub model for tests and local smoke runs.
 *
 * Always returns the same text answer and never calls the network. Useful when you need a real
 * harness loop without spending tokens or depending on OpenRouter. Prefer `ScriptedModelAdapter`
 * when the test must assert tool-calling multi-step behaviour.
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js';

/** Deterministic, offline model for CI and local runs. Always replies with `response`. */
export class MockModelAdapter implements ModelAdapter {
  readonly id = 'mock';

  constructor(private readonly response: string = '42') {}

  async complete(_modelId: string, _req: ModelRequest): Promise<ModelResponse> {
    return {
      message: { role: 'assistant', content: this.response },
      usage: { promptTokens: 10, completionTokens: 2 },
    };
  }
}
