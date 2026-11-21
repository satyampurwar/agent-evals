import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Trace } from '@agent-evals/domain';
import { Repository } from 'typeorm';
import { TraceStore } from '../common/trace-store.js';
import { TrialEntity } from '../entities/trial.entity.js';

/** Trial as returned over HTTP. The trace lives in its own file and is served by /trials/:id/trace. */
export type TrialView = Omit<TrialEntity, 'experiment'> & { hasTrace: boolean };

@Injectable()
export class TrialsService {
  constructor(
    @InjectRepository(TrialEntity) private readonly repo: Repository<TrialEntity>,
    private readonly traceStore: TraceStore,
  ) {}

  async list(experimentId?: string): Promise<TrialView[]> {
    const rows = await this.repo.find({
      where: experimentId ? { experimentId } : {},
      order: { experimentId: 'ASC', taskId: 'ASC', configId: 'ASC', trialIndex: 'ASC' },
    });
    return rows.map(toView);
  }

  async findOne(id: string): Promise<TrialView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`trial ${id} not found`);
    }
    return toView(row);
  }

  /** 404 when the trial is missing, when it has no trace yet, or when the trace file is gone. */
  async trace(id: string): Promise<Trace> {
    const row = await this.repo.findOne({ where: { id }, select: { id: true, traceUri: true } });
    if (!row) {
      throw new NotFoundException(`trial ${id} not found`);
    }
    if (!row.traceUri) {
      throw new NotFoundException(`trace for trial ${id} has not been recorded yet`);
    }
    try {
      return JSON.parse(await this.traceStore.read(row.traceUri)) as Trace;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException(`trace file for trial ${id} is missing`);
      }
      throw err;
    }
  }
}

function toView({ experiment: _experiment, ...rest }: TrialEntity): TrialView {
  return { ...rest, hasTrace: rest.traceUri != null };
}
