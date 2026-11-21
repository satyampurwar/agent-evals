// Harness adapter interface from implementation.md §6.2.
import type { Task, TraceEvent } from '@agent-evals/domain';
import type { ModelAdapter } from '@agent-evals/adapters-model';

/** Minimal memory contract; real stores arrive with the Hermes harness. */
export interface MemoryStore {
  read(query: string): Promise<unknown[]>;
  write(key: string, value: unknown): Promise<void>;
}

export const noopMemory: MemoryStore = {
  read: async () => [],
  write: async () => {},
};

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

export interface HarnessRunInput {
  task: Task;
  model: ModelAdapter;
  modelId: string;
  modelParams: { temperature: number; topP?: number };
  context: TrialContext;
}

export interface HarnessRunOutput {
  finalAnswer: string;
  stoppedReason: 'completed' | 'max_steps' | 'max_tokens' | 'timeout' | 'error';
  usage: { promptTokens: number; completionTokens: number };
  stepCount: number;
}

export interface HarnessAdapter {
  readonly id: string;
  readonly displayName: string;
  run(input: HarnessRunInput): Promise<HarnessRunOutput>;
}
