/**
 * `@agent-evals/domain` — shared Zod schemas / types for tasks, configs, experiments,
 * trials, traces, graders, and list-price cost helpers. No I/O: API, runner, graders,
 * and the UI all import shapes from here. Architecture overview: `deliverables/DESIGN.md`.
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
