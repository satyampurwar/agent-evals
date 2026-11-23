/**
 * BullMQ queue wrapper for trial jobs.
 *
 * BullMQ (built on Redis) = durable job queue:
 * - Producer: TrialQueue.enqueue (called when an experiment starts)
 * - Consumer: TrialProcessor (`@Processor(TRIAL_QUEUE)`) in ExecutionModule
 *
 * Job payload is tiny (`{ trialId }`); the worker loads task/config from Postgres.
 * `jobId: trialId` makes enqueue idempotent — adding the same trial twice does not
 * create a second job. Retries use exponential backoff (see defaultJobOptions).
 *
 * This file also exports `TrialQueueModule` so feature modules can import the queue
 * without duplicating Bull registration.
 */
import { Injectable, Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

/** Redis queue name shared by producer and consumer. */
export const TRIAL_QUEUE = 'trials';
export const TRIAL_JOB = 'trial';

/** Minimal job payload — look up everything else from the TrialEntity row. */
export interface TrialJobData {
  trialId: string;
}

@Injectable()
export class TrialQueue {
  constructor(@InjectQueue(TRIAL_QUEUE) private readonly queue: Queue<TrialJobData>) {}

  /**
   * One job per trial. jobId is the trial id, so enqueueing the same trial twice does not
   * create a second job. The worker also checks the trial's status before running it.
   */
  async enqueue(trialIds: string[]): Promise<void> {
    if (trialIds.length === 0) return;
    await this.queue.addBulk(
      trialIds.map((trialId) => ({
        name: TRIAL_JOB,
        data: { trialId },
        opts: { jobId: trialId },
      })),
    );
  }
}

@Module({
  imports: [
    BullModule.registerQueue({
      name: TRIAL_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    }),
  ],
  providers: [TrialQueue],
  exports: [TrialQueue],
})
export class TrialQueueModule {}
