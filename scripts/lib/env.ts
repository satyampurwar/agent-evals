/**
 * Shared helper for CLI scripts under `scripts/`.
 *
 * Why it exists: many scripts need secrets (e.g. OPENROUTER_API_KEY) and URLs (API_URL).
 * Locally those live in the repo-root `.env` file. CI often injects the same keys as real
 * environment variables instead. This helper loads the file when present, without overriding
 * anything already set in the shell.
 *
 * Not a CLI itself — import `loadDotEnv()` near the top of a script before reading `process.env`.
 */
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
