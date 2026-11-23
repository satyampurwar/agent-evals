import { z } from 'zod';

/**
 * Shared domain shapes for agent-evals.
 *
 * **Zod** (https://zod.dev) is a runtime schema library: you declare the shape of data once,
 * validate untrusted JSON against it, and TypeScript types are inferred with `z.infer<typeof Schema>`.
 * That keeps API payloads, DB rows, and in-memory objects aligned without hand-written duplicate types.
 *
 * agent-evals compares two agent **configs** on the same **tasks**. One **trial** is a single
 * (task × config × trialIndex) run in a fresh sandbox, then graded. An **experiment** expands the
 * task×config×nTrials matrix into trial rows that workers execute. After each trial, a **trace**
 * (append-only event log) and grade metrics land in storage for A/B stats.
 *
 * Key schemas in this file:
 * - **Task** — prompt, optional sandbox setup files/memory, allowed tools, and a list of graders
 * - **Config** — which harness (baseline / hermes), model provider, budgets, skills, memory
 * - **Experiment** — named A/B run: which tasks, which configs, how many trials each
 * - **Trial** — one matrix cell's lifecycle status, scores, token/cost metrics, trace URI
 * - **TraceEvent** / **Trace** — what the agent said and did (messages, tool calls, memory, errors)
 * - **GraderSpec** — discriminated union on `type` (`exact_match` | `unit_test` | `state_check` | `llm_judge`)
 *
 * A **discriminated union** means Zod picks the correct branch from a shared field (`type` here),
 * so each grader shape is validated separately while still typing as one `GraderSpec`.
 */

export const TaskIdSchema = z.string();
export const ConfigIdSchema = z.string();
export const ExperimentIdSchema = z.string();
export const TrialIdSchema = z.string();

export type TaskId = z.infer<typeof TaskIdSchema>;
export type ConfigId = z.infer<typeof ConfigIdSchema>;
export type ExperimentId = z.infer<typeof ExperimentIdSchema>;
export type TrialId = z.infer<typeof TrialIdSchema>;

/** One filesystem assertion used by a `state_check` grader (path relative to the sandbox). */
export const StateCheckSchema = z.object({
  path: z.string(),
  exists: z.boolean().optional(),
  equals: z.string().optional(),
  jsonPathEquals: z
    .object({
      path: z.string(),
      value: z.unknown(),
    })
    .optional(),
});

export type StateCheck = z.infer<typeof StateCheckSchema>;

/**
 * How a task decides pass/fail after the agent stops. Discriminated on `type`:
 * - `exact_match` — compare the agent's final answer string to `expected`
 * - `unit_test` — run a shell command in the sandbox; exit 0 = pass
 * - `state_check` — assert files exist / content / JSON paths after the run
 * - `llm_judge` — ask another model to score the answer against a named rubric
 */
export const GraderSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('exact_match'),
    field: z.literal('final_answer'),
    expected: z.string(),
    normalize: z.literal('trim_lower').optional(),
  }),
  z.object({
    type: z.literal('unit_test'),
    command: z.string(),
    timeoutMs: z.number(),
  }),
  z.object({
    type: z.literal('state_check'),
    checks: z.array(StateCheckSchema),
  }),
  z.object({
    type: z.literal('llm_judge'),
    rubricId: z.string(),
    judgeModel: z.string(),
    passThreshold: z.number(),
  }),
]);

export type GraderSpec = z.infer<typeof GraderSpecSchema>;

/** Optional per-task sandbox priming before the agent starts. */
export const TaskSetupSchema = z.object({
  files: z.record(z.string(), z.string()).optional(),
  seed: z.number().optional(),
  /** Facts already in the trial's memory store before the agent starts. Only reachable with memory enabled. */
  memory: z.record(z.string(), z.string()).optional(),
});

export type TaskSetup = z.infer<typeof TaskSetupSchema>;

/**
 * A single evaluation problem: what to ask the agent, how to set up the sandbox, and how to grade.
 * Tasks are shared across configs so A/B comparisons stay fair.
 */
export const TaskSchema = z.object({
  id: TaskIdSchema,
  version: z.string(),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  setup: TaskSetupSchema.optional(),
  toolsAllowed: z.array(z.string()).optional(),
  graders: z.array(GraderSpecSchema),
  tags: z.array(z.string()),
  expectedDiscriminators: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Task = z.infer<typeof TaskSchema>;

/**
 * One agent configuration under test: harness settings (tools, skills, memory, budgets) plus model choice.
 * `contentHash` fingerprints the config body so trials stay tied to the exact settings that ran.
 */
export const ConfigSchema = z.object({
  id: ConfigIdSchema,
  name: z.string(),
  version: z.number(),
  harness: z.object({
    id: z.string(),
    settings: z.object({
      skillsEnabled: z.array(z.string()),
      memory: z.object({
        enabled: z.boolean(),
        persistAcrossTrials: z.boolean(),
        maxItems: z.number().optional(),
      }),
      tools: z.array(z.string()),
      maxSteps: z.number(),
      maxTokens: z.number(),
      timeoutMs: z.number(),
    }),
  }),
  model: z.object({
    provider: z.string(),
    modelId: z.string(),
    temperature: z.number(),
    topP: z.number().optional(),
  }),
  contentHash: z.string(),
  createdAt: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * An A/B (or multi-config) experiment: run `nTrials` of each task×config pair, then compare pass rates.
 * Status tracks the overall lifecycle once the API expands the matrix into trial rows.
 */
export const ExperimentSchema = z.object({
  id: ExperimentIdSchema,
  name: z.string(),
  hypothesis: z.string().optional(),
  taskIds: z.array(TaskIdSchema),
  configIds: z.array(ConfigIdSchema),
  nTrials: z.number(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'partial']),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});

export type Experiment = z.infer<typeof ExperimentSchema>;

/** Aggregated grader outcome for one trial (`all_must_pass` today). */
export const GradeResultSchema = z.object({
  passed: z.boolean(),
  score: z.number(),
  graderResults: z.array(
    z.object({
      graderType: z.string(),
      passed: z.boolean(),
      score: z.number(),
      reasoning: z.string().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  aggregatePolicy: z.enum(['all_must_pass', 'weighted_mean']),
});

export type GradeResult = z.infer<typeof GradeResultSchema>;

/**
 * One (task × config × trialIndex) execution record. Workers dequeue these, run them in isolation,
 * then write status, metrics, grade, and a pointer to the trace file.
 */
export const TrialSchema = z.object({
  id: TrialIdSchema,
  experimentId: ExperimentIdSchema,
  taskId: TaskIdSchema,
  configId: ConfigIdSchema,
  configContentHash: z.string(),
  trialIndex: z.number(),
  status: z.enum([
    'queued',
    'running',
    'succeeded',
    'failed',
    'timeout',
    'cancelled',
  ]),
  seed: z.number(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  metrics: z.object({
    latencyMs: z.number(),
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
    /** Judge (llm_judge) tokens; priced into estimatedCostUsd, kept separate from agent totals. */
    judgePromptTokens: z.number(),
    judgeCompletionTokens: z.number(),
    estimatedCostUsd: z.number(),
    stepCount: z.number(),
    /**
     * Why the harness stopped. Null when the trial never reached the harness (setup/price errors).
     * Budget stops (`max_steps` / `max_tokens`) still have status `succeeded` and are graded.
     */
    stoppedReason: z
      .enum(['completed', 'max_steps', 'max_tokens', 'timeout', 'error'])
      .nullable(),
  }),
  grade: GradeResultSchema.optional(),
  traceUri: z.string(),
});

export type Trial = z.infer<typeof TrialSchema>;

/**
 * Append-only events emitted during a trial (messages, tools, memory, skills, step boundaries, errors).
 * Discriminated on `type` so consumers can switch safely on the event kind.
 */
export const TraceEventSchema = z.discriminatedUnion('type', [
  z.object({
    ts: z.string(),
    type: z.literal('message'),
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.unknown(),
    callId: z.string(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('tool_result'),
    callId: z.string(),
    ok: z.boolean(),
    result: z.unknown(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('memory_read'),
    query: z.string(),
    hits: z.array(z.unknown()),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('memory_write'),
    key: z.string(),
    value: z.unknown(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('skill_invoke'),
    skillId: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('step_boundary'),
    step: z.number(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
  }),
]);

export type TraceEvent = z.infer<typeof TraceEventSchema>;

/** Full trial transcript: events plus optional final answer / memory snapshot for debugging. */
export const TraceSchema = z.object({
  trialId: TrialIdSchema,
  events: z.array(TraceEventSchema),
  finalAnswer: z.string().optional(),
  memorySnapshot: z.unknown().optional(),
});

export type Trace = z.infer<typeof TraceSchema>;

/**
 * Request bodies for the API. Server-assigned fields (id, version, contentHash, createdAt)
 * are not accepted from clients.
 */
/**
 * Create-config body. `persistAcrossTrials: true` is rejected: memory never crosses trial
 * boundaries in this platform (deliverables/LIMITS.md §4).
 */
export const ConfigInputSchema = ConfigSchema.pick({ name: true, harness: true, model: true }).superRefine(
  (value, ctx) => {
    if (value.harness.settings.memory.persistAcrossTrials) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'persistAcrossTrials is not implemented; must be false',
        path: ['harness', 'settings', 'memory', 'persistAcrossTrials'],
      });
    }
  },
);
export type ConfigInput = z.infer<typeof ConfigInputSchema>;

export const TaskImportSchema = z.object({
  tasks: z.array(TaskSchema).min(1),
});
export type TaskImport = z.infer<typeof TaskImportSchema>;

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

/** Client payload to create an experiment; the API expands this into queued trial rows. */
export const ExperimentInputSchema = z.object({
  name: z.string().min(1),
  hypothesis: z.string().optional(),
  taskIds: z
    .array(TaskIdSchema)
    .min(1)
    .refine(uniqueIds, { message: 'taskIds must be unique' }),
  configIds: z
    .array(ConfigIdSchema)
    .min(1)
    .refine(uniqueIds, { message: 'configIds must be unique' }),
  nTrials: z.number().int().min(1).max(1000),
});
export type ExperimentInput = z.infer<typeof ExperimentInputSchema>;
