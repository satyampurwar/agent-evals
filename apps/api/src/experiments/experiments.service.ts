import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Experiment, ExperimentInput } from '@agent-evals/domain';
import { compareConfigs, NothingToCompareError, type CompareResult } from '@agent-evals/stats';
import { DataSource, In, Repository } from 'typeorm';
import { isUuid } from '../common/uuid.js';
import { ConfigsService } from '../configs/configs.service.js';
import { ConfigEntity } from '../entities/config.entity.js';
import { ExperimentEntity, type ConfigRef, type TaskRef } from '../entities/experiment.entity.js';
import { TrialEntity } from '../entities/trial.entity.js';
import { TrialQueue } from '../queue/trial-queue.js';
import { TasksService } from '../tasks/tasks.service.js';
import { toTrialView } from '../trials/trials.service.js';
import { toSideInput } from './compare-input.js';
import { type ExperimentExport, type ExportConfig } from './export.js';
import { countTrialsByStatus, type TrialCounts } from './experiment-status.js';
import { expandMatrix } from './expand-matrix.js';

/** Guard against accidentally queuing an enormous matrix in one request. */
export const MAX_TRIALS_PER_EXPERIMENT = 10_000;
const INSERT_BATCH_SIZE = 500;

@Injectable()
export class ExperimentsService {
  constructor(
    @InjectRepository(ExperimentEntity) private readonly experiments: Repository<ExperimentEntity>,
    private readonly tasks: TasksService,
    private readonly configs: ConfigsService,
    private readonly queue: TrialQueue,
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
   * Creates one trial row per matrix cell, moves the experiment to running, then enqueues one job per trial.
   * The rows are committed before enqueueing, so a worker never sees a job whose trial row is missing.
   * Locked, so starting twice cannot create trials twice.
   */
  async start(id: string): Promise<{ experiment: ExperimentEntity; queued: number }> {
    const { experiment, trialIds } = await this.dataSource.transaction(async (manager) => {
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
      const rows = planned.map((p) => ({
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
        traceUri: null,
        startedAt: null,
        finishedAt: null,
      }));
      // Chunked: one INSERT per batch keeps us under Postgres' 65,535 bind-parameter limit.
      for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
        await manager.insert(TrialEntity, rows.slice(i, i + INSERT_BATCH_SIZE));
      }

      experiment.status = 'running';
      await manager.save(experiment);
      return { experiment, trialIds: rows.map((r) => r.id) };
    });

    await this.queue.enqueue(trialIds);
    return { experiment, queued: trialIds.length };
  }

  /** Newest first. The UI lists experiments from here. */
  async findAll(): Promise<ExperimentEntity[]> {
    return this.experiments.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<ExperimentEntity> {
    const experiment = await this.experiments.findOne({ where: { id } });
    if (!experiment) {
      throw new NotFoundException(`experiment ${id} not found`);
    }
    return experiment;
  }

  countTrials(experimentId: string): Promise<TrialCounts> {
    return countTrialsByStatus(this.dataSource.manager, experimentId);
  }

  /**
   * Everything the export needs: the experiment, the configs it pins (in matrix order, with the
   * harness and model each one uses), and every trial, ordered like the trials list.
   */
  async exportData(id: string): Promise<ExperimentExport> {
    const experiment = await this.findOne(id);
    const configIds = experiment.configRefs.map((c) => c.id);
    const configRows = configIds.length
      ? await this.dataSource.manager.find(ConfigEntity, { where: { id: In(configIds) } })
      : [];
    const configs: ExportConfig[] = configIds
      .map((configId) => configRows.find((row) => row.id === configId))
      .filter((row): row is ConfigEntity => row !== undefined)
      .map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        contentHash: row.contentHash,
        harnessId: row.document.harness.id,
        provider: row.document.model.provider,
        modelId: row.document.model.modelId,
        temperature: row.document.model.temperature,
        ...(row.document.model.topP !== undefined ? { topP: row.document.model.topP } : {}),
      }));
    const trials = await this.dataSource.manager.find(TrialEntity, {
      where: { experimentId: id },
      order: { taskId: 'ASC', configId: 'ASC', trialIndex: 'ASC' },
    });
    return {
      experiment: this.toView(experiment),
      configs,
      trials: trials.map(toTrialView),
    };
  }

  /**
   * Compares two configs of one experiment on their scored trials (see toSideInput for what counts).
   * Both configs must belong to the experiment, and the comparison needs at least one task with a
   * scored trial on both sides.
   */
  async compare(experimentId: string, aConfigId: string, bConfigId: string): Promise<CompareResult & { experimentId: string }> {
    const experiment = await this.findOne(experimentId);
    if (aConfigId === bConfigId) {
      throw new BadRequestException('a and b must be different configs');
    }
    const inExperiment = new Set(experiment.configRefs.map((c) => c.id));
    const notInExperiment = [aConfigId, bConfigId].filter((id) => !inExperiment.has(id));
    if (notInExperiment.length) {
      throw new BadRequestException({
        message: 'config is not part of this experiment',
        configIds: notInExperiment,
      });
    }

    const rows = await this.dataSource.manager.find(TrialEntity, {
      where: { experimentId, configId: In([aConfigId, bConfigId]) },
      select: { taskId: true, trialIndex: true, configId: true, status: true, passed: true, metrics: true },
    });
    const a = toSideInput(aConfigId, rows.filter((r) => r.configId === aConfigId));
    const b = toSideInput(bConfigId, rows.filter((r) => r.configId === bConfigId));
    try {
      return { experimentId, ...compareConfigs(a, b) };
    } catch (err) {
      if (err instanceof NothingToCompareError) {
        throw new ConflictException(`${err.message}; the trials may still be running`);
      }
      throw err;
    }
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
