import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Trace } from '@agent-evals/domain';
import { Repository } from 'typeorm';
import { TrialEntity } from '../entities/trial.entity.js';

/** Trial as returned over HTTP: the trace is omitted (it has its own endpoint) and replaced by a flag. */
export type TrialView = Omit<TrialEntity, 'trace' | 'experiment'> & { hasTrace: boolean };

@Injectable()
export class TrialsService {
  constructor(@InjectRepository(TrialEntity) private readonly repo: Repository<TrialEntity>) {}

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

  /** 404 both when the trial is missing and when it has not produced a trace yet. */
  async trace(id: string): Promise<Trace> {
    const row = await this.repo.findOne({ where: { id }, select: { id: true, trace: true } });
    if (!row) {
      throw new NotFoundException(`trial ${id} not found`);
    }
    if (!row.trace) {
      throw new NotFoundException(`trace for trial ${id} has not been recorded yet`);
    }
    return row.trace;
  }
}

function toView({ trace, experiment: _experiment, ...rest }: TrialEntity): TrialView {
  return { ...rest, hasTrace: trace != null };
}
