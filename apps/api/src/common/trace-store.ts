import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default trace root: <repo>/data/traces (gitignored). Override with TRACE_DIR. */
export const DEFAULT_TRACE_DIR = fileURLToPath(new URL('../../../../data/traces', import.meta.url));

/**
 * Stores trace JSON files under one root directory. A trace URI is a key relative to that root
 * (`<experimentId>/<trialId>.json`), so stored rows still work if the repo is moved.
 */
export class TraceStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Writes the trace and returns its URI. Call this before marking the trial finished. */
  async write(experimentId: string, trialId: string, body: string): Promise<string> {
    const key = `${experimentId}/${trialId}.json`;
    const abs = this.resolveKey(key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, 'utf8');
    return key;
  }

  async read(key: string): Promise<string> {
    return readFile(this.resolveKey(key), 'utf8');
  }

  private resolveKey(key: string): string {
    const abs = resolve(this.root, key);
    if (!abs.startsWith(this.root + sep)) {
      throw new Error(`trace key escapes the trace root: ${key}`);
    }
    return abs;
  }
}
