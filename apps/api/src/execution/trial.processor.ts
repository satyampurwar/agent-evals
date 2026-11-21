import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TRIAL_QUEUE, type TrialJobData } from '../queue/trial-queue.js';
import { TrialExecutor } from './trial-executor.service.js';

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
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
    return this.executor.execute(job.data.trialId, { isFinalAttempt });
  }
}
