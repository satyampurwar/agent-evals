/**
 * Sandbox path safety — keep agent tool paths inside the trial directory.
 *
 * Agents (and task setup files) only supply relative paths. This module resolves them under
 * `sandboxDir` and refuses absolute paths, `..` escapes, and symlinks. Without this, a tool call
 * like `read_file("../../etc/passwd")` could leave the trial's isolation boundary.
 */

import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Thrown when a user-supplied path is empty, absolute, escapes the root, or hits a symlink. */
export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxPathError';
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Resolve a relative path inside `sandboxDir`.
 *
 * Fails closed (throws SandboxPathError) for:
 *  - empty or non-string paths
 *  - absolute paths
 *  - `..` segments that leave the sandbox
 *  - any existing component on the path that is a symlink (including dangling ones)
 *
 * The target itself does not need to exist (write_file creates new files).
 */
export async function resolveInSandbox(sandboxDir: string, userPath: string): Promise<string> {
  if (typeof userPath !== 'string' || userPath.trim() === '') {
    throw new SandboxPathError('path must be a non-empty string');
  }
  if (isAbsolute(userPath)) {
    throw new SandboxPathError(`absolute paths are not allowed: ${userPath}`);
  }

  const root = await realpath(sandboxDir);
  const target = resolve(root, userPath);
  if (!isInside(root, target)) {
    throw new SandboxPathError(`path escapes sandbox: ${userPath}`);
  }

  // Walk from the target back up to the sandbox root; refuse any symlink on the way.
  let cur = target;
  while (cur !== root && isInside(root, cur)) {
    try {
      const st = await lstat(cur);
      if (st.isSymbolicLink()) {
        throw new SandboxPathError(`symlinks are not allowed in sandbox: ${userPath}`);
      }
    } catch (err) {
      if (err instanceof SandboxPathError) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return target;
}
