import type { ConfigInput, ExperimentInput } from '@agent-evals/domain';

/** Tools a config can list. These are the base tools; memory and skill tools come from their own switches. */
export const BASE_TOOLS = ['read_file', 'write_file', 'list_dir'] as const;
/** Skill ids the harness knows. A config naming any other id fails at run time. */
export const SKILL_IDS = ['csv_summary'] as const;
export const MAX_PLANNED_TRIALS = 10_000;

export interface ConfigForm {
  name: string;
  modelId: string;
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
  if (!modelId) errors.push('Model id is required.');
  if (!(form.temperature >= 0 && form.temperature <= 2)) errors.push('Temperature must be between 0 and 2.');
  if (!isInt(form.maxSteps) || form.maxSteps < 1 || form.maxSteps > 50) errors.push('Max steps must be a whole number from 1 to 50.');
  if (!isInt(form.maxTokens) || form.maxTokens < 1 || form.maxTokens > 100_000) {
    errors.push('Max tokens must be a whole number from 1 to 100000.');
  }
  if (!isInt(form.timeoutMs) || form.timeoutMs < 1000 || form.timeoutMs > 600_000) {
    errors.push('Timeout must be a whole number of milliseconds from 1000 to 600000.');
  }
  for (const skill of form.skillsEnabled) {
    if (!(SKILL_IDS as readonly string[]).includes(skill)) errors.push(`Unknown skill: ${skill}.`);
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    input: {
      name,
      harness: {
        id: 'baseline',
        settings: {
          skillsEnabled: [...form.skillsEnabled],
          // persistAcrossTrials is stored but not implemented yet (see Phase 8), so it is always false here.
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
