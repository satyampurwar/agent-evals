/**
 * Queue-only trial worker (no HTTP port).
 *
 * Boots the same `AppModule` as the API via `createApplicationContext`, so
 * TypeORM + BullMQ + `TrialProcessor` run, but nothing listens on :3000.
 * Compose sets `TRIAL_WORKER=off` on the API service so only this process
 * consumes jobs (`jobId` = trial id).
 */
// Must load repo-root .env before AppModule reads process.env.
import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // Close DB/Redis cleanly on SIGTERM/SIGINT (Compose stop, Ctrl+C).
  app.enableShutdownHooks();
}

await bootstrap();
