/**
 * Seeds the task catalog into the API.
 *
 *   npm run seed:tasks                 # uses API_URL or http://localhost:3000
 *   API_URL=http://localhost:3001 npx tsx scripts/seed-tasks.ts
 *
 * Reads tasks/manifest.json, validates each task with the domain TaskSchema locally,
 * then POSTs the batch to /tasks/import. Re-running is safe: identical tasks are reported as unchanged.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskSchema, type Task } from '@agent-evals/domain';
import { loadDotEnv } from './lib/env';

loadDotEnv();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tasksDir = resolve(repoRoot, 'tasks');
const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

interface Manifest {
  tasks: string[];
}

function loadTasks(): Task[] {
  const manifest = JSON.parse(readFileSync(resolve(tasksDir, 'manifest.json'), 'utf8')) as Manifest;
  return manifest.tasks.map((relPath) => {
    const raw = JSON.parse(readFileSync(resolve(tasksDir, relPath), 'utf8')) as unknown;
    const parsed = TaskSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`invalid task ${relPath}: ${JSON.stringify(parsed.error.issues)}`);
    }
    return parsed.data;
  });
}

async function main(): Promise<void> {
  const tasks = loadTasks();
  console.log(`Seeding ${tasks.length} task(s) to ${apiUrl}/tasks/import`);

  const res = await fetch(`${apiUrl}/tasks/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tasks }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Import failed: HTTP ${res.status}\n${body}`);
    process.exit(1);
  }

  const result = JSON.parse(body) as { created: unknown[]; unchanged: unknown[] };
  console.log(`created: ${result.created.length}, unchanged: ${result.unchanged.length}`);
}

main().catch((err: unknown) => {
  const message = err instanceof TypeError ? `${err.message} (is the API running at ${apiUrl}?)` : String(err);
  console.error(message);
  process.exit(1);
});
