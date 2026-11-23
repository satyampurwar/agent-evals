/**
 * Harness adapter interface for agent-evals (implementation.md §6.2).
 *
 * A **HarnessAdapter** is the agent loop: it takes a task prompt, a `ModelAdapter`, sandbox path,
 * tools, and budgets, then runs until the model finishes or a limit is hit. The harness uses the
 * model for chat + tool calling; it does not grade. The runner creates the sandbox, calls
 * `harness.run`, then runs graders on the result.
 *
 * Two implementations ship today: `baseline` (TypeScript tool-calling loop in this package) and
 * `hermes` (HTTP client to a Python worker that owns its own loop). Both emit the same `TraceEvent`s
 * through `TrialContext.emit` so traces stay comparable across configs.
 */
import type { Task, TraceEvent } from '@agent-evals/domain';
import type { ModelAdapter } from '@agent-evals/adapters-model';

/** Minimal memory contract; real stores arrive with the Hermes harness. */
export interface MemoryStore {
  read(query: string): Promise<unknown[]>;
  write(key: string, value: unknown): Promise<void>;
}

/** No-op memory used when memory tools are not offered to the trial. */
export const noopMemory: MemoryStore = {
  read: async () => [],
  write: async () => {},
};

/** Per-trial runtime context the harness needs (sandbox, budgets, tools, trace sink). */
export interface TrialContext {
  trialId: string;
  seed: number;
  sandboxDir: string;
  budgets: { maxSteps: number; maxTokens: number; timeoutMs: number };
  memory: MemoryStore;
  skillIds: string[];
  toolIds: string[];
  /** Harness MUST emit all trace events through this. */
  emit: (event: TraceEvent) => void;
}

/** Input to one harness run (task + model + trial context). */
export interface HarnessRunInput {
  task: Task;
  model: ModelAdapter;
  modelId: string;
  modelParams: { temperature: number; topP?: number };
  context: TrialContext;
}

/** What the harness returns before graders run. */
export interface HarnessRunOutput {
  finalAnswer: string;
  stoppedReason: 'completed' | 'max_steps' | 'max_tokens' | 'timeout' | 'error';
  usage: { promptTokens: number; completionTokens: number };
  stepCount: number;
}

/**
 * Pluggable agent runtime. `id` matches `config.harness.id` (`baseline` | `hermes`).
 * Implementations must honour budgets and emit every conversational / tool event via `emit`.
 */
export interface HarnessAdapter {
  readonly id: string;
  readonly displayName: string;
  run(input: HarnessRunInput): Promise<HarnessRunOutput>;
}
