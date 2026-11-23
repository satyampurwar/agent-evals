/**
 * Load repo-root `.env` into `process.env` at import time.
 *
 * Imported first from `main.ts` / `worker.ts` so TypeORM and BullMQ see
 * `DATABASE_URL` / `REDIS_URL` / keys while modules are evaluated.
 * Path: `apps/api/src` → `../../../.env`. Shell-exported vars win over the file.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Side effect on import — do not call; just `import './load-env.js'`. */
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
