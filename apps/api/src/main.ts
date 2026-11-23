/**
 * HTTP API process entrypoint (NestJS).
 *
 * NestJS is a Node framework built around:
 * - Modules (`@Module`) — group related controllers/providers
 * - Controllers (`@Controller`) — map HTTP routes to methods
 * - Providers (`@Injectable` services) — business logic, injected via the constructor
 *
 * This file boots the full Nest app (HTTP + optional BullMQ trial worker). For a
 * worker-only process with no HTTP server, see `worker.ts`.
 *
 * Typical request path after boot:
 *   Vue UI / curl → Controllers → Services → Postgres (TypeORM) / Redis (BullMQ)
 * Trial execution itself is async: ExperimentsService enqueues jobs; TrialProcessor runs them.
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
