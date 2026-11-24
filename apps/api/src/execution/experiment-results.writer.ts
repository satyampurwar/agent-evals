/**
 * Writes an experiment's results to `RESULTS_DIR/<experimentId>/` once the experiment is finished.
 *
 * The worker calls this after it records a trial. When the trial was the last one, the experiment
 * is terminal (completed, partial or failed), and the files are written:
 * - `export.json` and `export.csv`: every trial, as `GET /experiments/:id/export` returns them
 * - `compare.json`: only when the experiment has exactly two configs (the first two, in matrix order)
 *
 * This gives UI-started experiments the same files that `scripts/run-experiment.ts` writes to `results/<name>/`.
 * It is opt-in: nothing is written unless `RESULTS_DIR` is set (docker-compose sets it for the worker).
 *
 * It never throws. The trial is already recorded when this runs, so a failed write is logged and skipped.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Repository } from 'typeorm';
import { ExperimentEntity } from '../entities/experiment.entity.js';
import { ExperimentsService } from '../experiments/experiments.service.js';
import { experimentToCsv } from '../experiments/export.js';

/** Statuses after which no trial can change the experiment any more. */
const TERMINAL_STATUSES = new Set<string>(['completed', 'partial', 'failed']);

@Injectable()
export class ExperimentResultsWriter {
  private readonly logger = new Logger(ExperimentResultsWriter.name);

  constructor(
    @InjectRepository(ExperimentEntity) private readonly experiments: Repository<ExperimentEntity>,
    private readonly service: ExperimentsService,
  ) {}

  /** Writes the result files if the experiment is finished. Safe to call after every trial. */
  async writeIfFinished(experimentId: string): Promise<void> {
    const root = process.env.RESULTS_DIR;
    if (!root) return;

    try {
      const experiment = await this.experiments.findOneBy({ id: experimentId });
      if (!experiment || !TERMINAL_STATUSES.has(experiment.status)) return;

      const outDir = resolve(root, experimentId);
      await mkdir(outDir, { recursive: true });

      const data = await this.service.exportData(experimentId);
      await writeAtomic(resolve(outDir, 'export.json'), JSON.stringify(data, null, 2));
      await writeAtomic(resolve(outDir, 'export.csv'), experimentToCsv(data));

      if (experiment.configRefs.length === 2) {
        const [a, b] = experiment.configRefs.map((c) => c.id);
        try {
          const compare = await this.service.compare(experimentId, a!, b!);
          await writeAtomic(resolve(outDir, 'compare.json'), JSON.stringify(compare, null, 2));
        } catch (err) {
          // Compare needs at least one task with a scored trial on both sides; the export files are still useful.
          this.logger.warn(`experiment ${experimentId}: compare.json skipped: ${messageOf(err)}`);
        }
      }

      this.logger.log(`experiment ${experimentId}: results written to ${outDir}`);
    } catch (err) {
      this.logger.warn(`experiment ${experimentId}: results not written: ${messageOf(err)}`);
    }
  }
}

/** Writes to a temporary file, then renames it, so a reader never sees a half-written file. */
async function writeAtomic(path: string, body: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, path);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
