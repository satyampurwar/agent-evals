import { describe, expect, it } from 'vitest';
import { expandMatrix, seedFor } from './expand-matrix.js';

const tasks = [
  { id: 'det_add_01', version: '1.0.0', contentHash: 'h-task-1' },
  { id: 'det_write_answer_01', version: '1.0.0', contentHash: 'h-task-2' },
];
const configs = [
  { id: '11111111-1111-4111-8111-111111111111', contentHash: 'h-cfg-1' },
  { id: '22222222-2222-4222-8222-222222222222', contentHash: 'h-cfg-2' },
];

describe('expandMatrix', () => {
  it('produces tasks x configs x nTrials planned trials', () => {
    const planned = expandMatrix('exp-1', tasks, configs, 3);
    expect(planned).toHaveLength(2 * 2 * 3);
  });

  it('pins the task version and config content hash on every planned trial', () => {
    const planned = expandMatrix('exp-1', tasks, configs, 1);
    const first = planned[0];
    expect(first).toMatchObject({
      taskId: 'det_add_01',
      taskVersion: '1.0.0',
      configId: configs[0].id,
      configContentHash: 'h-cfg-1',
      trialIndex: 0,
    });
  });

  it('gives each cell a unique (task, config, trialIndex) key', () => {
    const planned = expandMatrix('exp-1', tasks, configs, 4);
    const keys = new Set(planned.map((p) => `${p.taskId}|${p.configId}|${p.trialIndex}`));
    expect(keys.size).toBe(planned.length);
  });

  it('is deterministic for the same inputs', () => {
    expect(expandMatrix('exp-1', tasks, configs, 2)).toEqual(expandMatrix('exp-1', tasks, configs, 2));
  });
});

describe('seedFor', () => {
  it('is stable for the same trial identity', () => {
    expect(seedFor('e', 't', 'c', 0)).toBe(seedFor('e', 't', 'c', 0));
  });

  it('differs when any part of the identity changes', () => {
    const base = seedFor('e', 't', 'c', 0);
    expect(seedFor('e2', 't', 'c', 0)).not.toBe(base);
    expect(seedFor('e', 't', 'c', 1)).not.toBe(base);
  });

  it('fits in a signed 32-bit integer', () => {
    const seed = seedFor('e', 't', 'c', 7);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});
