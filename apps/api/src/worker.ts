/**
 * Background trial-worker process (no HTTP).
 *
 * Why a separate entrypoint?
 * BullMQ jobs live in Redis. Any Nest process that registers `TrialProcessor` will
 * pull jobs. If both the API and another worker consumed the same queue, jobs would
 * still be unique (jobId = trialId), but splitting processes lets you scale workers
 * independently and keep the API responsive.
 *
 * How to run split mode:
 * - API:   TRIAL_WORKER=off  → ExecutionModule skips TrialProcessor (see execution.module.ts)
 * - Worker: this file        → createApplicationContext boots the same AppModule (DB, Redis,
 *   TrialProcessor) but does NOT open an HTTP port
 *
 * `createApplicationContext` = Nest DI + lifecycle without Express/Fastify listeners.
 */
// Must be the first import: loads the repo-root .env before AppModule reads process.env.
import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * Trial consumer without HTTP. Run the API with TRIAL_WORKER=off, and this process with the default
 * (TRIAL_WORKER unset), so each job is consumed by exactly one process. The Nest app context boots the
 * same modules as the API and starts the BullMQ processor.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // Ensures TypeORM/Redis connections close cleanly on SIGTERM/SIGINT (Docker stop, Ctrl+C).
  app.enableShutdownHooks();
}

await bootstrap();
