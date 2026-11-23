/**
 * BullMQ worker host — Nest's bridge from Redis jobs into TrialExecutor.
 *
 * `@Processor(TRIAL_QUEUE)` registers this class as a consumer when ExecutionModule
 * is loaded (unless TRIAL_WORKER=off). Nest instantiates it and BullMQ calls
 * `process()` for each job, up to `TRIAL_CONCURRENCY` in parallel.
 *
 * `WorkerHost` is the Nest+BullMQ base class; you implement `process`, Nest wires the rest.
 * Retryable failures: TrialExecutor throws → BullMQ retries; on the last attempt,
 * `isFinalAttempt` tells the executor to record `failed` instead of re-queuing.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TRIAL_QUEUE, type TrialJobData } from '../queue/trial-queue.js';
import { TrialExecutor } from './trial-executor.service.js';

/** How many trials this process may run at once (OpenRouter rate / wallet limits matter). */
function trialConcurrency(): number {
  const n = Number(process.env.TRIAL_CONCURRENCY ?? 2);
  return Number.isInteger(n) && n > 0 ? n : 2;
}

/** BullMQ consumer. Each job is one trial. Concurrency is capped to respect provider rate limits. */
@Processor(TRIAL_QUEUE, { concurrency: trialConcurrency() })
export class TrialProcessor extends WorkerHost {
  constructor(private readonly executor: TrialExecutor) {
    super();
  }

  async process(job: Job<TrialJobData>): Promise<string> {
    const maxAttempts = job.opts.attempts ?? 1;
    // attemptsMade is 0-based count of prior tries; +1 = the attempt about to run.
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    return this.executor.execute(job.data.trialId, { isFinalAttempt });
  }
}
