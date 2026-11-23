/**
 * `@agent-evals/adapters-harness` — agent "harnesses" (how the model is looped with tools).
 *
 * A harness implements `HarnessAdapter.run`: given a task + model + sandbox context,
 * drive the agent until it answers or hits a budget, emitting TraceEvents along the way.
 * The runner calls `createHarness` then `harness.run`; graders live in `@agent-evals/graders`.
 *
 * Built-in harnesses:
 * - `baseline` — TypeScript tool-calling loop in this package
 * - `hermes` — HTTP client to the Python worker that runs Hermes Agent
 *
 * Also exports tools (read/write/list, memory, CSV skill), memory store, and `createHarness`.
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
