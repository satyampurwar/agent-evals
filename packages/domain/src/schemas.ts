import { z } from 'zod';

/**
 * Domain shapes from implementation.md §5.
 * Zod is the single source; inferred types match those interfaces.
 */

export const TaskIdSchema = z.string();
export const ConfigIdSchema = z.string();
export const ExperimentIdSchema = z.string();
export const TrialIdSchema = z.string();

export type TaskId = z.infer<typeof TaskIdSchema>;
export type ConfigId = z.infer<typeof ConfigIdSchema>;
export type ExperimentId = z.infer<typeof ExperimentIdSchema>;
export type TrialId = z.infer<typeof TrialIdSchema>;

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

export const TaskSetupSchema = z.object({
  files: z.record(z.string(), z.string()).optional(),
  seed: z.number().optional(),
});

export type TaskSetup = z.infer<typeof TaskSetupSchema>;

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
    estimatedCostUsd: z.number(),
    stepCount: z.number(),
  }),
  grade: GradeResultSchema.optional(),
  traceUri: z.string(),
});

export type Trial = z.infer<typeof TrialSchema>;

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
export const ConfigInputSchema = ConfigSchema.pick({ name: true, harness: true, model: true });
export type ConfigInput = z.infer<typeof ConfigInputSchema>;

export const TaskImportSchema = z.object({
  tasks: z.array(TaskSchema).min(1),
});
export type TaskImport = z.infer<typeof TaskImportSchema>;

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

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
