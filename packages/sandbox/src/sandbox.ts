import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveInSandbox } from './paths';

export interface Sandbox {
  /** Absolute path of the trial's private working directory. */
  readonly dir: string;
  /** Removes the directory and everything in it. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/** Creates a fresh, empty directory for one trial. Trials never share a directory. */
export async function createSandbox(trialId: string): Promise<Sandbox> {
  const safe = trialId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  const dir = await mkdtemp(join(tmpdir(), `agent-evals-${safe}-`));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Writes task setup files (relative path -> content) into the sandbox. */
export async function materializeFiles(
  sandboxDir: string,
  files: Record<string, string> = {},
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = await resolveInSandbox(sandboxDir, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
}
