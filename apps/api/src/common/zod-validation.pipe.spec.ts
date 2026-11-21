import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ConfigInputSchema, ExperimentInputSchema } from '@agent-evals/domain';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  it('returns the parsed value for a valid body', () => {
    const pipe = new ZodValidationPipe(ExperimentInputSchema);
    const out = pipe.transform({ name: 'x', taskIds: ['a'], configIds: ['c'], nTrials: 2 });
    expect(out).toMatchObject({ name: 'x', nTrials: 2 });
  });

  it('throws 400 with zod issues for an invalid body', () => {
    const pipe = new ZodValidationPipe(ExperimentInputSchema);
    try {
      pipe.transform({ name: 'x', taskIds: [], configIds: ['c'], nTrials: 2 });
      expect.unreachable('transform should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { issues: unknown[] };
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });

  it('strips server-assigned fields a client tries to set on a config', () => {
    const pipe = new ZodValidationPipe(ConfigInputSchema);
    const out = pipe.transform({
      id: 'forged',
      version: 99,
      contentHash: 'forged',
      name: 'c',
      harness: {
        id: 'baseline',
        settings: {
          skillsEnabled: [],
          memory: { enabled: false, persistAcrossTrials: false },
          tools: [],
          maxSteps: 1,
          maxTokens: 1,
          timeoutMs: 1,
        },
      },
      model: { provider: 'mock', modelId: 'm', temperature: 0 },
    });
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('version');
    expect(out).not.toHaveProperty('contentHash');
  });
});
