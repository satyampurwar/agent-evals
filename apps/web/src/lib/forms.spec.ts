import { describe, expect, it } from 'vitest';
import { buildConfigInput, buildExperimentInput, defaultConfigForm, MAX_PLANNED_TRIALS } from './forms';

describe('buildConfigInput', () => {
  it('builds the same shape the API expects, with the base tools and memory off by default', () => {
    const r = buildConfigInput({ ...defaultConfigForm(), name: ' base ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.name).toBe('base');
    expect(r.input.harness).toEqual({
      id: 'baseline',
      settings: {
        skillsEnabled: [],
        memory: { enabled: false, persistAcrossTrials: false },
        tools: ['read_file', 'write_file', 'list_dir'],
        maxSteps: 8,
        maxTokens: 4096,
        timeoutMs: 60000,
      },
    });
    expect(r.input.model).toEqual({ provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', temperature: 0 });
  });

  it('never sends persistAcrossTrials as true, since that is not implemented', () => {
    const r = buildConfigInput({ ...defaultConfigForm(), name: 'x', memoryEnabled: true });
    expect(r.ok && r.input.harness.settings.memory).toEqual({ enabled: true, persistAcrossTrials: false });
  });

  it('reports every problem at once', () => {
    const r = buildConfigInput({
      ...defaultConfigForm(),
      name: '  ',
      temperature: 3,
      maxSteps: 0,
      maxTokens: 1.5,
      timeoutMs: 10,
      skillsEnabled: ['nope'],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(6);
    expect(r.errors.join(' ')).toMatch(/Name is required/);
    expect(r.errors.join(' ')).toMatch(/Unknown skill: nope/);
  });

  it('accepts the boundary values', () => {
    const r = buildConfigInput({ ...defaultConfigForm(), name: 'edge', temperature: 2, maxSteps: 50, timeoutMs: 1000 });
    expect(r.ok).toBe(true);
  });
});

describe('buildExperimentInput', () => {
  const base = { name: 'run', hypothesis: '', taskIds: ['t1'], configIds: ['c1'], nTrials: 3 };

  it('drops an empty hypothesis instead of sending it', () => {
    const r = buildExperimentInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input).not.toHaveProperty('hypothesis');
  });

  it('keeps a non-empty hypothesis, trimmed', () => {
    const r = buildExperimentInput({ ...base, hypothesis: '  memory helps  ' });
    expect(r.ok && r.input.hypothesis).toBe('memory helps');
  });

  it('requires a task, a config, and a sane trial count', () => {
    const r = buildExperimentInput({ ...base, name: '', taskIds: [], configIds: [], nTrials: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      'Name is required.',
      'Pick at least one task.',
      'Pick at least one config.',
      'Trials per cell must be a whole number from 1 to 1000.',
    ]);
  });

  it('refuses a matrix over the API limit before sending it', () => {
    // 11 tasks x 1 config x 1000 trials per cell = 11000, over the 10000 limit. Each cell is within 1000.
    const taskIds = Array.from({ length: 11 }, (_, i) => `t${i}`);
    const r = buildExperimentInput({ ...base, taskIds, configIds: ['b'], nTrials: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([`This would create 11000 trials; the limit is ${MAX_PLANNED_TRIALS}.`]);
  });
});
