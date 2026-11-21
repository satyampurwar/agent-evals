import type { ModelAdapter, ModelRequest, ModelResponse } from './types';

/**
 * Deterministic model for tests and offline demos. Replays `script` in order,
 * one response per call, and records every request it receives.
 * Throws if the harness asks for more responses than the script provides.
 */
export class ScriptedModelAdapter implements ModelAdapter {
  readonly id = 'scripted';
  readonly requests: ModelRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: ModelResponse[]) {}

  async complete(_modelId: string, req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(req));
    const next = this.script[this.cursor];
    if (!next) {
      throw new Error(`scripted model exhausted after ${this.cursor} response(s)`);
    }
    this.cursor += 1;
    return structuredClone(next);
  }
}
