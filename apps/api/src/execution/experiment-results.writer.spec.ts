import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentResultsWriter } from './experiment-results.writer.js';

type Deps = ConstructorParameters<typeof ExperimentResultsWriter>;

function makeWriter(opts: { status: string; configIds: string[]; compareError?: Error; exportError?: Error }) {
  const repo = {
    findOneBy: vi.fn().mockResolvedValue({
      id: 'exp-1',
      status: opts.status,
      configRefs: opts.configIds.map((id) => ({ id, contentHash: 'h' })),
    }),
  };
  const service = {
    exportData: opts.exportError
      ? vi.fn().mockRejectedValue(opts.exportError)
      : vi.fn().mockResolvedValue({ experiment: { id: 'exp-1' }, configs: [], trials: [] }),
    compare: opts.compareError
      ? vi.fn().mockRejectedValue(opts.compareError)
      : vi.fn().mockResolvedValue({ verdict: 'likely_noise' }),
  };
  const writer = new ExperimentResultsWriter(repo as unknown as Deps[0], service as unknown as Deps[1]);
  return { writer, repo, service };
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('ExperimentResultsWriter', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'results-'));
    process.env.RESULTS_DIR = dir;
  });

  afterEach(async () => {
    delete process.env.RESULTS_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it('does nothing when RESULTS_DIR is not set', async () => {
    delete process.env.RESULTS_DIR;
    const { writer, service } = makeWriter({ status: 'completed', configIds: ['a', 'b'] });
    await writer.writeIfFinished('exp-1');
    expect(service.exportData).not.toHaveBeenCalled();
  });

  it('writes nothing while the experiment is still running', async () => {
    const { writer, service } = makeWriter({ status: 'running', configIds: ['a', 'b'] });
    await writer.writeIfFinished('exp-1');
    expect(service.exportData).not.toHaveBeenCalled();
    expect(await exists(join(dir, 'exp-1'))).toBe(false);
  });

  it('writes export and compare files into a folder named by the experiment id when two configs ran', async () => {
    const { writer, service } = makeWriter({ status: 'completed', configIds: ['a', 'b'] });
    await writer.writeIfFinished('exp-1');

    expect(service.compare).toHaveBeenCalledWith('exp-1', 'a', 'b');
    const outDir = join(dir, 'exp-1');
    expect(JSON.parse(await readFile(join(outDir, 'export.json'), 'utf8'))).toEqual({
      experiment: { id: 'exp-1' },
      configs: [],
      trials: [],
    });
    expect(await readFile(join(outDir, 'export.csv'), 'utf8')).toMatch(/^experimentId,taskId,/);
    expect(JSON.parse(await readFile(join(outDir, 'compare.json'), 'utf8'))).toEqual({ verdict: 'likely_noise' });
    expect(await exists(join(outDir, 'compare.json.tmp'))).toBe(false);
  });

  it('skips compare.json when the experiment has three configs, but still writes the export', async () => {
    const { writer, service } = makeWriter({ status: 'partial', configIds: ['a', 'b', 'c'] });
    await writer.writeIfFinished('exp-1');

    expect(service.compare).not.toHaveBeenCalled();
    expect(await exists(join(dir, 'exp-1', 'export.json'))).toBe(true);
    expect(await exists(join(dir, 'exp-1', 'compare.json'))).toBe(false);
  });

  it('still writes the export when compare has nothing to compare', async () => {
    const { writer } = makeWriter({
      status: 'completed',
      configIds: ['a', 'b'],
      compareError: new Error('no task has a scored trial for both configs'),
    });
    await expect(writer.writeIfFinished('exp-1')).resolves.toBeUndefined();
    expect(await exists(join(dir, 'exp-1', 'export.json'))).toBe(true);
    expect(await exists(join(dir, 'exp-1', 'compare.json'))).toBe(false);
  });

  it('never throws when the export fails, because the trial is already recorded', async () => {
    const { writer } = makeWriter({
      status: 'failed',
      configIds: ['a', 'b'],
      exportError: new Error('database unavailable'),
    });
    await expect(writer.writeIfFinished('exp-1')).resolves.toBeUndefined();
  });
});
