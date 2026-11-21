import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TraceStore } from './trace-store.js';

describe('TraceStore', () => {
  let root: string;
  let store: TraceStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'trace-store-'));
    store = new TraceStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes a trace under experiment/trial and reads it back', async () => {
    const uri = await store.write('exp-1', 'trial-1', '{"trialId":"trial-1","events":[]}');
    expect(uri).toBe('exp-1/trial-1.json');
    expect(JSON.parse(await store.read(uri))).toEqual({ trialId: 'trial-1', events: [] });
  });

  it('refuses keys that escape the trace root', async () => {
    await expect(store.read('../secret.json')).rejects.toThrow(/escapes the trace root/);
    await expect(store.write('../../x', 'y', '{}')).rejects.toThrow(/escapes the trace root/);
  });
});
