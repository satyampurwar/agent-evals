/**
 * HTTP API entrypoint for agent-evals.
 *
 * Serves tasks, configs, experiments, trials, compare, export, and failures.
 * In Compose, this process runs with `TRIAL_WORKER=off`; the sibling `worker`
 * process (`worker.ts`) consumes the BullMQ trials queue.
 *
 * Request path: Vue UI / curl → controllers → services → Postgres / Redis.
 * Trial runs are async: start experiment → enqueue jobs → worker → TraceStore + trial row.
 */
// Must be the first import: loads the repo-root .env before AppModule reads process.env.
import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

/** Builds the Nest application and starts listening for HTTP. */
async function bootstrap() {
  // NestFactory.create wires up AppModule: DI container, TypeORM, BullMQ, route handlers.
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
