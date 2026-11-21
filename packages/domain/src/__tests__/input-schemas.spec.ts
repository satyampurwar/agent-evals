import { describe, expect, it } from 'vitest';
import { ConfigInputSchema, ExperimentInputSchema } from '../schemas.js';

const validConfigInput = {
  name: 'baseline-gpt-mini',
  harness: {
    id: 'baseline',
    settings: {
      skillsEnabled: [],
      memory: { enabled: false, persistAcrossTrials: false },
      tools: ['read_file', 'write_file', 'list_dir'],
      maxSteps: 8,
      maxTokens: 2048,
      timeoutMs: 60000,
    },
  },
  model: { provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', temperature: 0.2 },
};

describe('ConfigInputSchema', () => {
  it('accepts a config body without server-assigned fields', () => {
    expect(ConfigInputSchema.parse(validConfigInput)).toMatchObject({ name: 'baseline-gpt-mini' });
  });

  it('drops id, version, contentHash and createdAt if a client sends them', () => {
    const parsed = ConfigInputSchema.parse({ ...validConfigInput, id: 'x', version: 9, contentHash: 'h' });
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('version');
    expect(parsed).not.toHaveProperty('contentHash');
  });

  it('rejects a missing model', () => {
    const { model: _model, ...noModel } = validConfigInput;
    expect(() => ConfigInputSchema.parse(noModel)).toThrow();
  });
});

describe('ExperimentInputSchema', () => {
  const base = { name: 'exp', taskIds: ['det_add_01'], configIds: ['c1', 'c2'], nTrials: 3 };

  it('accepts a valid experiment', () => {
    expect(ExperimentInputSchema.parse(base)).toMatchObject({ nTrials: 3 });
  });

  it('rejects duplicate task or config ids', () => {
    expect(() => ExperimentInputSchema.parse({ ...base, taskIds: ['a', 'a'] })).toThrow(/unique/);
    expect(() => ExperimentInputSchema.parse({ ...base, configIds: ['c', 'c'] })).toThrow(/unique/);
  });

  it('rejects empty lists and out-of-range nTrials', () => {
    expect(() => ExperimentInputSchema.parse({ ...base, taskIds: [] })).toThrow();
    expect(() => ExperimentInputSchema.parse({ ...base, nTrials: 0 })).toThrow();
    expect(() => ExperimentInputSchema.parse({ ...base, nTrials: 1.5 })).toThrow();
    expect(() => ExperimentInputSchema.parse({ ...base, nTrials: 1001 })).toThrow();
  });
});
