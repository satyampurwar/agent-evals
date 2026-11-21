// Hermes Agent harness. Hermes runs in the Python worker (workers/python-worker), which owns the model call and
// the tool loop. This adapter sends one trial to the worker and turns the reply into trace events. The contract
// is documented in the worker's README and in `contract.py`.
import { TraceEventSchema } from '@agent-evals/domain';
import type { Task } from '@agent-evals/domain';
import type { HarnessAdapter, HarnessRunInput, HarnessRunOutput } from './types.js';

export const DEFAULT_HERMES_WORKER_URL = 'http://127.0.0.1:8001';

const STOP_REASONS: readonly HarnessRunOutput['stoppedReason'][] = [
  'completed',
  'max_steps',
  'max_tokens',
  'timeout',
  'error',
];

export interface HermesHarnessOptions {
  /** Base URL of the Python worker. Defaults to HERMES_WORKER_URL, then http://127.0.0.1:8001. */
  workerUrl?: string;
}

export class HermesHarness implements HarnessAdapter {
  readonly id = 'hermes';
  readonly displayName = 'Hermes Agent (Python worker)';
  private readonly workerUrl: string;

  constructor(options: HermesHarnessOptions = {}) {
    const url = options.workerUrl ?? process.env.HERMES_WORKER_URL ?? DEFAULT_HERMES_WORKER_URL;
    this.workerUrl = url.replace(/\/+$/, '');
  }

  async run(input: HarnessRunInput): Promise<HarnessRunOutput> {
    const { task, modelId, modelParams, context } = input;
    // `input.model` and `context.memory` belong to the TypeScript loop. Hermes uses its own model client, and
    // the worker seeds its own per-trial memory from `task.setup.memory`, the same source the runner uses.
    const body = {
      trialId: context.trialId,
      task: { id: task.id, prompt: task.prompt },
      config: {
        modelId,
        temperature: modelParams.temperature,
        ...(modelParams.topP !== undefined ? { topP: modelParams.topP } : {}),
        maxSteps: context.budgets.maxSteps,
        maxTokens: context.budgets.maxTokens,
        timeoutMs: context.budgets.timeoutMs,
      },
      toolIds: context.toolIds,
      memorySeed: memorySeedOf(task),
      sandboxDir: context.sandboxDir,
      seed: context.seed,
    };

    let res: Response;
    try {
      res = await fetch(`${this.workerUrl}/run-trial`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`hermes worker unreachable at ${this.workerUrl}: ${reason}`);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`hermes worker returned ${res.status}: ${text.slice(0, 500)}`);
    }

    const reply = parseReply(parseJson(text));
    for (const raw of reply.events) {
      const parsed = TraceEventSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`hermes worker sent an invalid trace event: ${parsed.error.message}`);
      }
      context.emit(parsed.data);
    }

    return {
      finalAnswer: reply.finalAnswer,
      stoppedReason: reply.stoppedReason,
      usage: reply.usage,
      stepCount: reply.stepCount,
    };
  }
}

function memorySeedOf(task: Task): Record<string, string> {
  return task.setup?.memory ?? {};
}

interface HermesReply {
  finalAnswer: string;
  stoppedReason: HarnessRunOutput['stoppedReason'];
  events: unknown[];
  usage: { promptTokens: number; completionTokens: number };
  stepCount: number;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`hermes worker returned a non-JSON reply: ${text.slice(0, 200)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReply(value: unknown): HermesReply {
  if (!isRecord(value)) throw new Error('hermes worker reply is not an object');
  const { finalAnswer, stoppedReason, events, usage, stepCount } = value;
  if (typeof finalAnswer !== 'string') throw new Error('hermes worker reply: finalAnswer must be a string');
  if (!STOP_REASONS.includes(stoppedReason as HarnessRunOutput['stoppedReason'])) {
    throw new Error(`hermes worker reply: unknown stoppedReason ${JSON.stringify(stoppedReason)}`);
  }
  if (!Array.isArray(events)) throw new Error('hermes worker reply: events must be an array');
  if (!isRecord(usage) || typeof usage.promptTokens !== 'number' || typeof usage.completionTokens !== 'number') {
    throw new Error('hermes worker reply: usage must have numeric promptTokens and completionTokens');
  }
  if (typeof stepCount !== 'number') throw new Error('hermes worker reply: stepCount must be a number');
  return {
    finalAnswer,
    stoppedReason: stoppedReason as HarnessRunOutput['stoppedReason'],
    events,
    usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
    stepCount,
  };
}
