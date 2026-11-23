/**
 * Side-effect module: load repo-root `.env` into `process.env` at import time.
 *
 * Why a separate file imported first from `main.ts` / `worker.ts`?
 * Nest modules (especially `AppModule`) read `process.env` while they are being
 * evaluated. If dotenv ran later, DATABASE_URL / Redis / API keys would be missing
 * during TypeORM and BullMQ setup.
 *
 * Path resolution: this file lives at `apps/api/src/`, so `../../../.env` is the
 * monorepo root `agent-evals/.env`. Shell-exported vars still win over the file.
 *
 * `import.meta.url` is the ESM way to know "where is this file on disk?" so the
 * path works whether you run via tsx, compiled JS, or Docker.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repo-root `.env` (apps/api/src -> ../../../.env) before any other module reads
 * process.env. Variables already set in the shell win over the file.
 *
 * Imported first from main.ts so it runs before AppModule is evaluated.
 */
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
