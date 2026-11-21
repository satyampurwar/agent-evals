import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolCall, ToolSpec } from '@agent-evals/adapters-model';
import { resolveInSandbox, SandboxPathError } from '@agent-evals/sandbox';

/** Every tool the baseline harness knows how to run. Tasks can narrow this with `toolsAllowed`. */
export const TOOL_NAMES = ['write_file', 'read_file', 'list_dir'] as const;

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'write_file',
    description:
      'Write UTF-8 text to a file in the sandbox. Creates parent directories and overwrites existing files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path inside the sandbox' },
        content: { type: 'string', description: 'Full file contents' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the sandbox.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path inside the sandbox' } },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries of a directory in the sandbox. Use "." for the sandbox root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative directory path' } },
      required: ['path'],
    },
  },
];

export interface ToolOutcome {
  ok: boolean;
  result: unknown;
}

/** Tool specs for the ids a trial is allowed to use. Unknown ids are ignored. */
export function specsFor(toolIds: readonly string[]): ToolSpec[] {
  return TOOL_SPECS.filter((s) => toolIds.includes(s.name));
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') {
    throw new Error(`missing or invalid argument: ${key}`);
  }
  return v;
}

function describeError(err: unknown, path?: string): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return `not found: ${path ?? 'path'}`;
  if (code === 'EISDIR') return `is a directory: ${path ?? 'path'}`;
  if (code === 'ENOTDIR') return `not a directory: ${path ?? 'path'}`;
  if (err instanceof SandboxPathError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run one tool call against the sandbox. Never throws: failures come back as
 * `{ ok: false, result: { error } }` so the model can see them and recover.
 */
export async function executeTool(sandboxDir: string, call: ToolCall): Promise<ToolOutcome> {
  const args = call.arguments ?? {};
  let path: string | undefined;
  try {
    switch (call.name) {
      case 'write_file': {
        path = requireString(args, 'path');
        const content = requireString(args, 'content');
        const abs = await resolveInSandbox(sandboxDir, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
        return { ok: true, result: { path, bytes: Buffer.byteLength(content, 'utf8') } };
      }
      case 'read_file': {
        path = requireString(args, 'path');
        const abs = await resolveInSandbox(sandboxDir, path);
        const content = await readFile(abs, 'utf8');
        return { ok: true, result: { path, content } };
      }
      case 'list_dir': {
        path = requireString(args, 'path');
        const abs = await resolveInSandbox(sandboxDir, path);
        const entries = await readdir(abs, { withFileTypes: true });
        const listing = entries
          .map((d) => ({
            name: d.name,
            type: d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other',
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return { ok: true, result: { path, entries: listing } };
      }
      default:
        return { ok: false, result: { error: `unknown tool: ${call.name}` } };
    }
  } catch (err) {
    return { ok: false, result: { error: describeError(err, path) } };
  }
}
