import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { Config, Task } from '@agent-evals/domain';
import { createHarness, resolveToolIds } from '@agent-evals/adapters-harness';
import { createModelAdapter } from '@agent-evals/adapters-model';
import { runTrial } from '@agent-evals/runner';
import type { RunTrialResult } from '@agent-evals/runner';
import { serializeTrace } from '@agent-evals/trace';
import { TraceStore } from '../common/trace-store.js';
import { loadPriceTable } from './prices.js';
import { ConfigEntity } from '../entities/config.entity.js';
import { ExperimentEntity } from '../entities/experiment.entity.js';
import { TaskEntity } from '../entities/task.entity.js';
import { TrialEntity, type TrialStatus } from '../entities/trial.entity.js';
import { countTrialsByStatus, rollupExperimentStatus } from '../experiments/experiment-status.js';

const TERMINAL: TrialStatus[] = ['succeeded', 'failed', 'timeout', 'cancelled'];

export interface ExecuteOptions {
  /** True on the last BullMQ attempt. A retryable failure is recorded as failed only then. */
  isFinalAttempt: boolean;
}

/**
 * Runs one trial from the queue. Idempotent: a trial that already reached a terminal status is skipped,
 * so a redelivered or duplicate job cannot run or score a trial twice.
 */
@Injectable()
export class TrialExecutor {
  private readonly logger = new Logger(TrialExecutor.name);

  constructor(
    @InjectRepository(TrialEntity) private readonly trials: Repository<TrialEntity>,
    @InjectRepository(ConfigEntity) private readonly configs: Repository<ConfigEntity>,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    private readonly dataSource: DataSource,
    private readonly traceStore: TraceStore,
  ) {}

  /** Returns 'finished' when this call recorded the outcome, 'skipped' otherwise. Throws to request a BullMQ retry. */
  async execute(trialId: string, { isFinalAttempt }: ExecuteOptions): Promise<'finished' | 'skipped'> {
    const trial = await this.trials.findOne({ where: { id: trialId } });
    if (!trial) {
      this.logger.warn(`trial ${trialId} not found; dropping job`);
      return 'skipped';
    }
    if (TERMINAL.includes(trial.status)) {
      return 'skipped';
    }

    await this.trials.update(
      { id: trialId, status: In(['queued', 'running']) },
      { status: 'running', startedAt: trial.startedAt ?? new Date() },
    );

    const outcome = await this.runOnce(trial);

    if (outcome.status === 'failed' && outcome.error?.retryable && !isFinalAttempt) {
      // Put the trial back in the queue state, then let BullMQ retry the job with backoff.
      await this.trials.update({ id: trialId, status: 'running' }, { status: 'queued' });
      throw new Error(`trial ${trialId} hit a retryable failure: ${outcome.error.code}: ${outcome.error.message}`);
    }

    // Trace first, then the trial row (implementation.md §11.4), so a finished trial always has its trace.
    const traceUri = await this.traceStore.write(trial.experimentId, trialId, serializeTrace(outcome.trace));
    const recorded = await this.finalize(trialId, outcome, traceUri);
    return recorded ? 'finished' : 'skipped';
  }

  private async runOnce(trial: TrialEntity): Promise<RunTrialResult> {
    try {
      const config = await this.configs.findOne({ where: { id: trial.configId } });
      const task = await this.tasks.findOne({ where: { id: trial.taskId, version: trial.taskVersion } });
      if (!config || !task) {
        throw new Error(`missing config ${trial.configId} or task ${trial.taskId}@${trial.taskVersion}`);
      }

      const cfg: Config = config.document;
      const taskDoc: Task = task.document;
      const settings = cfg.harness.settings;
      // The config picks the tools (core, memory, skills); a task may narrow them further but cannot widen them.
      const toolIds = resolveToolIds(
        {
          tools: settings.tools,
          memoryEnabled: settings.memory.enabled,
          skillsEnabled: settings.skillsEnabled,
        },
        taskDoc.toolsAllowed,
      );

      return await runTrial({
        trialId: trial.id,
        task: taskDoc,
        prices: loadPriceTable(),
        harness: createHarness(cfg.harness.id),
        model: createModelAdapter(cfg.model.provider),
        modelId: cfg.model.modelId,
        modelParams: { temperature: cfg.model.temperature, topP: cfg.model.topP },
        seed: trial.seed,
        budgets: {
          maxSteps: settings.maxSteps,
          maxTokens: settings.maxTokens,
          timeoutMs: settings.timeoutMs,
        },
        toolIds,
        memorySeed: taskDoc.setup?.memory,
      });
    } catch (err) {
      // Bad config, unknown provider, or missing API key: setup problems are not retried.
      return setupFailure(trial.id, err);
    }
  }

  /**
   * Writes the outcome and rolls up the experiment status in one transaction. Locks the trial row and
   * only writes when it is still running, so a racing duplicate finalizes nothing.
   */
  private finalize(trialId: string, outcome: RunTrialResult, traceUri: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const trial = await manager.findOne(TrialEntity, {
        where: { id: trialId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!trial || trial.status !== 'running') {
        return false;
      }

      Object.assign(trial, {
        status: outcome.status,
        passed: outcome.passed,
        score: outcome.score,
        grade: outcome.grade,
        metrics: outcome.metrics,
        error: outcome.error,
        traceUri,
        finishedAt: new Date(),
      });
      await manager.save(trial);

      const experiment = await manager.findOne(ExperimentEntity, {
        where: { id: trial.experimentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (experiment) {
        const next = rollupExperimentStatus(await countTrialsByStatus(manager, experiment.id));
        if (next !== 'running' && experiment.status !== next) {
          experiment.status = next;
          experiment.completedAt = new Date();
          await manager.save(experiment);
        }
      }
      return true;
    });
  }
}

function setupFailure(trialId: string, err: unknown): RunTrialResult {
  return {
    status: 'failed',
    passed: false,
    score: 0,
    grade: null,
    stoppedReason: null,
    finalAnswer: '',
    metrics: { latencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, stepCount: 0 },
    error: {
      code: 'setup_error',
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
    },
    trace: { trialId, events: [] },
  };
}
