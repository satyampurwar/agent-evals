import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Experiment, ExperimentInput } from '@agent-evals/domain';
import { DataSource, Repository } from 'typeorm';
import { isUuid } from '../common/uuid.js';
import { ConfigsService } from '../configs/configs.service.js';
import { ConfigEntity } from '../entities/config.entity.js';
import { ExperimentEntity, type ConfigRef, type TaskRef } from '../entities/experiment.entity.js';
import { TrialEntity } from '../entities/trial.entity.js';
import { TasksService } from '../tasks/tasks.service.js';
import { expandMatrix } from './expand-matrix.js';

/** Guard against accidentally queuing an enormous matrix in one request. */
export const MAX_TRIALS_PER_EXPERIMENT = 10_000;
const INSERT_BATCH_SIZE = 500;

export type TrialCounts = Record<TrialEntity['status'] | 'total', number>;

@Injectable()
export class ExperimentsService {
  constructor(
    @InjectRepository(ExperimentEntity) private readonly experiments: Repository<ExperimentEntity>,
    @InjectRepository(TrialEntity) private readonly trials: Repository<TrialEntity>,
    private readonly tasks: TasksService,
    private readonly configs: ConfigsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates a pending experiment. Task and config versions are pinned now (latest task version
   * at creation time), so later imports do not change what this experiment runs.
   */
  async create(input: ExperimentInput): Promise<ExperimentEntity> {
    const taskRefs: TaskRef[] = [];
    const missingTasks: string[] = [];
    for (const taskId of input.taskIds) {
      try {
        const task = await this.tasks.findOne(taskId);
        taskRefs.push({ id: task.id, version: task.version, contentHash: task.contentHash });
      } catch (err) {
        if (err instanceof NotFoundException) missingTasks.push(taskId);
        else throw err;
      }
    }

    const configRefs: ConfigRef[] = [];
    const missingConfigs: string[] = [];
    for (const configId of input.configIds) {
      const config = isUuid(configId) ? await this.findConfigOrNull(configId) : null;
      if (config) configRefs.push({ id: config.id, contentHash: config.contentHash });
      else missingConfigs.push(configId);
    }

    if (missingTasks.length || missingConfigs.length) {
      throw new BadRequestException({
        message: 'Unknown task or config references',
        missingTaskIds: missingTasks,
        missingConfigIds: missingConfigs,
      });
    }

    const planned = taskRefs.length * configRefs.length * input.nTrials;
    if (planned > MAX_TRIALS_PER_EXPERIMENT) {
      throw new BadRequestException(
        `experiment would create ${planned} trials; the limit is ${MAX_TRIALS_PER_EXPERIMENT}`,
      );
    }

    return this.experiments.save(
      this.experiments.create({
        id: randomUUID(),
        name: input.name,
        hypothesis: input.hypothesis ?? null,
        taskRefs,
        configRefs,
        nTrials: input.nTrials,
        status: 'pending',
        createdAt: new Date(),
        completedAt: null,
      }),
    );
  }

  /**
   * Queues one trial per cell of the pinned matrix and moves the experiment from pending to running.
   * Runs in a transaction with a row lock, so starting twice cannot queue trials twice.
   */
  async start(id: string): Promise<{ experiment: ExperimentEntity; queued: number }> {
    return this.dataSource.transaction(async (manager) => {
      const experiment = await manager.findOne(ExperimentEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!experiment) {
        throw new NotFoundException(`experiment ${id} not found`);
      }
      if (experiment.status !== 'pending') {
        throw new ConflictException(
          `experiment is ${experiment.status}; only pending experiments can be started`,
        );
      }

      const planned = expandMatrix(experiment.id, experiment.taskRefs, experiment.configRefs, experiment.nTrials);
      // Chunked: one INSERT per batch keeps us under Postgres' 65,535 bind-parameter limit.
      for (let i = 0; i < planned.length; i += INSERT_BATCH_SIZE) {
        await manager.insert(
          TrialEntity,
          planned.slice(i, i + INSERT_BATCH_SIZE).map((p) => ({
            id: randomUUID(),
            experimentId: experiment.id,
            taskId: p.taskId,
            taskVersion: p.taskVersion,
            configId: p.configId,
            configContentHash: p.configContentHash,
            trialIndex: p.trialIndex,
            seed: p.seed,
            status: 'queued' as const,
            score: null,
            passed: null,
            metrics: {},
            grade: null,
            error: null,
            trace: null,
            traceUri: null,
            startedAt: null,
            finishedAt: null,
          })),
        );
      }

      experiment.status = 'running';
      await manager.save(experiment);
      return { experiment, queued: planned.length };
    });
  }

  async findOne(id: string): Promise<ExperimentEntity> {
    const experiment = await this.experiments.findOne({ where: { id } });
    if (!experiment) {
      throw new NotFoundException(`experiment ${id} not found`);
    }
    return experiment;
  }

  async countTrials(experimentId: string): Promise<TrialCounts> {
    const rows = await this.trials
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('t.experimentId = :experimentId', { experimentId })
      .groupBy('t.status')
      .getRawMany<{ status: TrialEntity['status']; count: string }>();

    const counts: TrialCounts = {
      total: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      timeout: 0,
      cancelled: 0,
    };
    for (const row of rows) {
      const n = Number(row.count);
      counts[row.status] = n;
      counts.total += n;
    }
    return counts;
  }

  /** Maps the stored row to the public Experiment shape from the domain package. */
  toView(experiment: ExperimentEntity): Experiment {
    return {
      id: experiment.id,
      name: experiment.name,
      ...(experiment.hypothesis ? { hypothesis: experiment.hypothesis } : {}),
      taskIds: experiment.taskRefs.map((t) => t.id),
      configIds: experiment.configRefs.map((c) => c.id),
      nTrials: experiment.nTrials,
      status: experiment.status,
      createdAt: experiment.createdAt.toISOString(),
      ...(experiment.completedAt ? { completedAt: experiment.completedAt.toISOString() } : {}),
    };
  }

  private async findConfigOrNull(id: string): Promise<ConfigEntity | null> {
    try {
      return await this.configs.findOne(id);
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }
}