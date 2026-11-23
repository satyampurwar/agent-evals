/**
 * Scripted offline model for unit tests of the harness / runner.
 *
 * Unlike `MockModelAdapter` (one fixed string), this replays a prepared list of full
 * `ModelResponse`s — including tool calls — so you can drive a multi-step agent loop without
 * a live LLM. Every request is recorded on `requests` for assertions.
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from './types.js';

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
