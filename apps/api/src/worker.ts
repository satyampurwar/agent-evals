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
  app.enableShutdownHooks();
}

await bootstrap();
