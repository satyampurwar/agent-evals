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
