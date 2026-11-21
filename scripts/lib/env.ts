import { existsSync } from 'node:fs';

/**
 * Loads KEY=VALUE pairs from a .env file into process.env.
 * Existing environment variables win, so a shell export overrides the file.
 * Missing file is not an error (CI can inject env directly).
 */
export function loadDotEnv(file = '.env'): void {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}
