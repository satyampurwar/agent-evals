/**
 * `@agent-evals/adapters-harness` — agent loops (`HarnessAdapter`) + tools.
 *
 * `createHarness(id)` → `baseline` (TS tool-calling loop) or `hermes` (HTTP client to
 * `workers/python-worker`). Runner calls `harness.run` with task, model, sandbox, budgets;
 * harnesses emit `TraceEvent`s. Also: file tools, memory store, `csv_summary` skill.
 * Graders live in `@agent-evals/graders`.
 */
export type {
  HarnessAdapter,
  HarnessRunInput,
  HarnessRunOutput,
  MemoryStore,
  TrialContext,
} from './types.js';
export { noopMemory } from './types.js';
export { BaselineHarness } from './baseline.js';
export { DEFAULT_HERMES_WORKER_URL, HermesHarness } from './hermes.js';
export type { HermesHarnessOptions } from './hermes.js';
export {
  MEMORY_TOOL_NAMES,
  TOOL_NAMES,
  TOOL_SPECS,
  executeTool,
  resolveToolIds,
  specsFor,
} from './tools.js';
export type { ToolOutcome, ToolSettings } from './tools.js';
export { createTrialMemory } from './memory.js';
export type { MemoryEntry } from './memory.js';
export { CSV_OPS, SKILL_TOOLS, csvSummary } from './skills.js';
export type { CsvOp, CsvSummaryResult } from './skills.js';
export { createHarness, HARNESS_IDS } from './registry.js';
