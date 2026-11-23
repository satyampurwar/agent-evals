/**
 * Nest module for background trial execution.
 *
 * `TypeOrmModule.forFeature([...])` registers repositories for these entities in
 * *this* module's DI scope (root forRoot already registered the connection).
 *
 * Providers:
 * - TrialExecutor — always registered (needed to run trials)
 * - TrialProcessor — only if TRIAL_WORKER is not `off`, so the HTTP API can refuse
 *   to consume jobs while `worker.ts` does
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraceStoreModule } from '../common/trace-store.module.js';
import { ConfigEntity } from '../entities/config.entity.js';
import { ExperimentEntity } from '../entities/experiment.entity.js';
import { TaskEntity } from '../entities/task.entity.js';
import { TrialEntity } from '../entities/trial.entity.js';
import { TrialQueueModule } from '../queue/trial-queue.js';
import { TrialExecutor } from './trial-executor.service.js';
import { TrialProcessor } from './trial.processor.js';

/** Set TRIAL_WORKER=off to run the API without consuming the queue (e.g. a separate worker process). */
const workerEnabled = process.env.TRIAL_WORKER !== 'off';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrialEntity, ConfigEntity, TaskEntity, ExperimentEntity]),
    TrialQueueModule,
    TraceStoreModule,
  ],
  providers: [TrialExecutor, ...(workerEnabled ? [TrialProcessor] : [])],
})
export class ExecutionModule {}
