import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, materializeFiles, resolveInSandbox, SandboxPathError } from './index';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'sandbox-spec-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('createSandbox', () => {
  it('gives each trial a distinct directory, and cleanup removes it', async () => {
    const a = await createSandbox('trial-a');
    const b = await createSandbox('trial-a');
    try {
      expect(a.dir).not.toBe(b.dir);
      expect(existsSync(a.dir)).toBe(true);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
    expect(existsSync(a.dir)).toBe(false);
    // second cleanup is a no-op
    await expect(a.cleanup()).resolves.toBeUndefined();
  });
});

describe('resolveInSandbox', () => {
  it('allows nested relative paths, including ones that do not exist yet', async () => {
    const root = join(base, 'root');
    await mkdir(root);
    const p = await resolveInSandbox(root, 'a/b/c.txt');
    expect(p.endsWith(join('a', 'b', 'c.txt'))).toBe(true);
  });

  it('rejects absolute paths', async () => {
    const root = join(base, 'root');
    await mkdir(root);
    await expect(resolveInSandbox(root, '/etc/passwd')).rejects.toBeInstanceOf(SandboxPathError);
  });

  it('rejects .. escapes', async () => {
    const root = join(base, 'root');
    await mkdir(root);
    await expect(resolveInSandbox(root, '../x')).rejects.toBeInstanceOf(SandboxPathError);
    await expect(resolveInSandbox(root, 'a/../../x')).rejects.toBeInstanceOf(SandboxPathError);
  });

  it('allows names that merely start with ..', async () => {
    const root = join(base, 'root');
    await mkdir(root);
    await expect(resolveInSandbox(root, '..notes.txt')).resolves.toBeTruthy();
  });

  it('rejects a symlinked directory that points outside the sandbox', async () => {
    const root = join(base, 'root');
    const outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, join(root, 'link'));
    await expect(resolveInSandbox(root, 'link/file.txt')).rejects.toBeInstanceOf(SandboxPathError);
  });

  it('rejects a dangling symlink', async () => {
    const root = join(base, 'root');
    await mkdir(root);
    await symlink(join(base, 'nowhere'), join(root, 'dangling'));
    await expect(resolveInSandbox(root, 'dangling')).rejects.toBeInstanceOf(SandboxPathError);
  });
});

describe('materializeFiles', () => {
  it('writes nested setup files inside the sandbox', async () => {
    const root = join(base, 'root');
    await mkdir(root);
    await materializeFiles(root, { 'data/input.txt': 'hello', 'top.txt': 'x' });
    expect(await readFile(join(root, 'data', 'input.txt'), 'utf8')).toBe('hello');
    expect(await readFile(join(root, 'top.txt'), 'utf8')).toBe('x');
  });

  it('refuses setup paths that escape the sandbox', async () => {
    const root = join(base, 'root');
    await mkdir(root);
    await expect(materializeFiles(root, { '../evil.txt': 'x' })).rejects.toBeInstanceOf(
      SandboxPathError,
    );
    expect(existsSync(join(base, 'evil.txt'))).toBe(false);
  });
});
