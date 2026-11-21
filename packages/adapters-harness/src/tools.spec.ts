import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, specsFor, TOOL_NAMES } from './tools';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tools-spec-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const call = (name: string, args: Record<string, unknown>) => ({ id: 'c', name, arguments: args });

describe('write_file / read_file', () => {
  it('writes then reads back, creating parent directories', async () => {
    const w = await executeTool(root, call('write_file', { path: 'out/answer.txt', content: 'ok' }));
    expect(w.ok).toBe(true);
    const r = await executeTool(root, call('read_file', { path: 'out/answer.txt' }));
    expect(r).toEqual({ ok: true, result: { path: 'out/answer.txt', content: 'ok' } });
    expect(await readFile(join(root, 'out', 'answer.txt'), 'utf8')).toBe('ok');
  });

  it('read_file on a missing file fails with a readable error', async () => {
    const r = await executeTool(root, call('read_file', { path: 'nope.txt' }));
    expect(r.ok).toBe(false);
    expect(r.result).toEqual({ error: 'not found: nope.txt' });
  });

  it('refuses to write outside the sandbox', async () => {
    const box = join(root, 'box');
    await mkdir(box);
    const w = await executeTool(box, call('write_file', { path: '../escape.txt', content: 'x' }));
    expect(w.ok).toBe(false);
    expect(existsSync(join(root, 'escape.txt'))).toBe(false);
  });

  it('refuses reads through a symlink that points outside', async () => {
    const box = join(root, 'box');
    await mkdir(box);
    await executeTool(root, call('write_file', { path: 'secret.txt', content: 'S' })); // writes into root, not box
    await symlink(join(root, 'secret.txt'), join(box, 'link.txt'));
    const r = await executeTool(box, call('read_file', { path: 'link.txt' }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).not.toContain('S"');
  });
});

describe('list_dir', () => {
  it('lists files and directories sorted by name', async () => {
    await executeTool(root, call('write_file', { path: 'b.txt', content: '' }));
    await executeTool(root, call('write_file', { path: 'a/inner.txt', content: '' }));
    const r = await executeTool(root, call('list_dir', { path: '.' }));
    expect(r.ok).toBe(true);
    expect(r.result).toEqual({
      path: '.',
      entries: [
        { name: 'a', type: 'dir' },
        { name: 'b.txt', type: 'file' },
      ],
    });
  });
});

describe('argument and tool-name handling', () => {
  it('reports missing arguments instead of throwing', async () => {
    const r = await executeTool(root, call('write_file', { path: 'x.txt' }));
    expect(r).toEqual({ ok: false, result: { error: 'missing or invalid argument: content' } });
  });

  it('reports unknown tools instead of throwing', async () => {
    const r = await executeTool(root, call('rm_rf', {}));
    expect(r).toEqual({ ok: false, result: { error: 'unknown tool: rm_rf' } });
  });

  it('specsFor returns only the allowed tools', () => {
    expect(specsFor(['read_file']).map((s) => s.name)).toEqual(['read_file']);
    expect(specsFor([])).toEqual([]);
    expect(TOOL_NAMES).toEqual(['write_file', 'read_file', 'list_dir']);
  });
});
