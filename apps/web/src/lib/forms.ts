/**
 * Config / experiment form defaults and client-side validation for the Vue UI.
 *
 * Pages hold `reactive` form state; before POST they call `buildConfigInput` /
 * `buildExperimentInput` to produce the Nest payload or a list of errors.
 * `MODEL_IDS` / `HARNESS_IDS` / `BASE_TOOLS` / `SKILL_IDS` drive the Configs dropdowns.
 */
import type { ConfigInput, ExperimentInput } from '@agent-evals/domain';

/** Tools a config can list. These are the base tools; memory and skill tools come from their own switches. */
export const BASE_TOOLS = ['read_file', 'write_file', 'list_dir'] as const;
/** Skill ids the harness knows. A config naming any other id fails at run time. */
export const SKILL_IDS = ['csv_summary'] as const;
/**
 * Harnesses registered in `@agent-evals/adapters-harness`. Hermes needs the Python worker;
 * claude-agent reaches its model through OpenRouter and works best with `anthropic/*` models.
 */
export const HARNESS_IDS = ['baseline', 'hermes', 'claude-agent'] as const;
/**
 * OpenRouter model ids with list prices in repo-root `prices.json`.
 * Unpriced models fail trials with `price_missing` before any call.
 */
export const MODEL_IDS = [
  'openai/gpt-4.1-mini',
  'openai/gpt-6.1-terra',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash',
] as const;
export const MAX_PLANNED_TRIALS = 10_000;

export interface ConfigForm {
  name: string;
  harnessId: (typeof HARNESS_IDS)[number];
  modelId: (typeof MODEL_IDS)[number] | string;
  temperature: number;
  memoryEnabled: boolean;
  skillsEnabled: string[];
  tools: string[];
  maxSteps: number;
  maxTokens: number;
  timeoutMs: number;
}

export function defaultConfigForm(): ConfigForm {
  return {
    name: '',
    harnessId: 'baseline',
    modelId: 'openai/gpt-4.1-mini',
    temperature: 0,
    memoryEnabled: false,
    skillsEnabled: [],
    tools: [...BASE_TOOLS],
    maxSteps: 8,
    maxTokens: 4096,
    timeoutMs: 60_000,
  };
}

export type BuildResult<T> = { ok: true; input: T } | { ok: false; errors: string[] };

function isInt(x: number): boolean {
  return Number.isInteger(x);
}

export function buildConfigInput(form: ConfigForm): BuildResult<ConfigInput> {
  const errors: string[] = [];
  const name = form.name.trim();
  const modelId = form.modelId.trim();
  if (!name) errors.push('Name is required.');
  if (!modelId) errors.push('Model is required.');
  else if (!(MODEL_IDS as readonly string[]).includes(modelId)) {
    errors.push(`Model must be one of: ${MODEL_IDS.join(', ')}.`);
  }
  if (!(form.temperature >= 0 && form.temperature <= 2)) errors.push('Temperature must be between 0 and 2.');
  if (!isInt(form.maxSteps) || form.maxSteps < 1 || form.maxSteps > 50) errors.push('Max steps must be a whole number from 1 to 50.');
  if (!isInt(form.maxTokens) || form.maxTokens < 1 || form.maxTokens > 100_000) {
    errors.push('Max tokens must be a whole number from 1 to 100000.');
  }
  if (!isInt(form.timeoutMs) || form.timeoutMs < 1000 || form.timeoutMs > 600_000) {
    errors.push('Timeout must be a whole number of milliseconds from 1000 to 600000.');
  }
  if (!(HARNESS_IDS as readonly string[]).includes(form.harnessId)) {
    errors.push(`Harness must be one of: ${HARNESS_IDS.join(', ')}.`);
  }
  for (const skill of form.skillsEnabled) {
    if (!(SKILL_IDS as readonly string[]).includes(skill)) errors.push(`Unknown skill: ${skill}.`);
  }
  // Skills are expanded into tool names for every harness (resolveToolIds on the API). Hermes gets those tool names, never skill ids.
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    input: {
      name,
      harness: {
        id: form.harnessId,
        settings: {
          skillsEnabled: [...form.skillsEnabled],
          // persistAcrossTrials is not implemented; always false (API also rejects true).
          memory: { enabled: form.memoryEnabled, persistAcrossTrials: false },
          tools: [...form.tools],
          maxSteps: form.maxSteps,
          maxTokens: form.maxTokens,
          timeoutMs: form.timeoutMs,
        },
      },
      model: { provider: 'openrouter', modelId, temperature: form.temperature },
    },
  };
}

export interface ExperimentForm {
  name: string;
  hypothesis: string;
  taskIds: string[];
  configIds: string[];
  nTrials: number;
}

/** How much of a list is selected. Drives the "Select all" checkbox: empty, partly checked, or checked. */
export type SelectionState = 'none' | 'some' | 'all';

export function selectionState(selected: readonly string[], all: readonly string[]): SelectionState {
  const chosen = all.filter((id) => selected.includes(id)).length;
  if (chosen === 0) return 'none';
  return chosen === all.length ? 'all' : 'some';
}

/**
 * The selection after "Select all" is clicked: everything, unless everything is already selected,
 * in which case nothing. Ids that are not in `all` (for example a task that was removed) are dropped.
 */
export function toggleAll(selected: readonly string[], all: readonly string[]): string[] {
  return selectionState(selected, all) === 'all' ? [] : [...all];
}

export function buildExperimentInput(form: ExperimentForm): BuildResult<ExperimentInput> {
  const errors: string[] = [];
  const name = form.name.trim();
  if (!name) errors.push('Name is required.');
  if (form.taskIds.length === 0) errors.push('Pick at least one task.');
  if (form.configIds.length === 0) errors.push('Pick at least one config.');
  if (!isInt(form.nTrials) || form.nTrials < 1 || form.nTrials > 1000) {
    errors.push('Trials per cell must be a whole number from 1 to 1000.');
  }
  const planned = form.taskIds.length * form.configIds.length * form.nTrials;
  if (planned > MAX_PLANNED_TRIALS) {
    errors.push(`This would create ${planned} trials; the limit is ${MAX_PLANNED_TRIALS}.`);
  }
  if (errors.length) return { ok: false, errors };

  const hypothesis = form.hypothesis.trim();
  return {
    ok: true,
    input: {
      name,
      ...(hypothesis ? { hypothesis } : {}),
      taskIds: [...form.taskIds],
      configIds: [...form.configIds],
      nTrials: form.nTrials,
    },
  };
}
