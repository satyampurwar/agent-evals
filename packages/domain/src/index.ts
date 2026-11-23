/**
 * `@agent-evals/domain` — shared Zod schemas and TypeScript types for tasks, configs,
 * experiments, trials, traces, graders, and cost metering. Other packages import from here
 * so everyone agrees on the same shapes; this package has no I/O of its own.
 */

export {
  ConfigIdSchema,
  ConfigInputSchema,
  ConfigSchema,
  ExperimentIdSchema,
  ExperimentInputSchema,
  ExperimentSchema,
  GradeResultSchema,
  GraderSpecSchema,
  StateCheckSchema,
  TaskIdSchema,
  TaskImportSchema,
  TaskSchema,
  TaskSetupSchema,
  TraceEventSchema,
  TraceSchema,
  TrialIdSchema,
  TrialSchema,
} from './schemas.js';

export { PriceEntrySchema, PriceTableSchema, UnknownPriceError, costUsd, unpricedModels } from './pricing.js';

export type {
  Config,
  ConfigId,
  ConfigInput,
  Experiment,
  ExperimentId,
  ExperimentInput,
  GradeResult,
  GraderSpec,
  StateCheck,
  Task,
  TaskId,
  TaskImport,
  TaskSetup,
  Trace,
  TraceEvent,
  Trial,
  TrialId,
} from './schemas.js';

export type { PriceEntry, PriceTable, TokenUsage } from './pricing.js';
