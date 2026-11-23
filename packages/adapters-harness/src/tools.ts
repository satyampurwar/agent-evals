/**
 * Tools the baseline agent can call during a trial.
 *
 * Tool-calling agents do not run arbitrary code in the model; they request named functions
 * (`write_file`, `read_file`, `memory_read`, …). This module defines the OpenAI-style tool specs,
 * resolves which ids a trial may use (config ∩ task), and executes calls against the sandbox.
 *
 * **Path safety:** every filesystem tool goes through `resolveInSandbox` so `../` or absolute paths
 * cannot escape the trial directory. Failures return `{ ok: false }` so the model can recover
 * instead of crashing the harness.
 */

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolCall, ToolSpec } from '@agent-evals/adapters-model';
import { resolveInSandbox, SandboxPathError } from '@agent-evals/sandbox';
import { CSV_OPS, csvSummary, SKILL_TOOLS } from './skills.js';
import { noopMemory, type MemoryStore } from './types.js';

/** Core tools. Always available unless the config leaves them out. Tasks can narrow this with `toolsAllowed`. */
export const TOOL_NAMES = ['write_file', 'read_file', 'list_dir'] as const;

/** Offered only when `harness.settings.memory.enabled` is true. */
export const MEMORY_TOOL_NAMES = ['memory_read', 'memory_write'] as const;

const SKILL_TOOL_NAMES: readonly string[] = Object.values(SKILL_TOOLS).flat();

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'memory_read',
    description:
      'Search the memory store. Returns every entry whose key or value contains all the words in the query. Use "" to list everything.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to look for, e.g. "client id"' } },
      required: ['query'],
    },
  },
  {
    name: 'memory_write',
    description: 'Store a text value under a key in the memory store. Overwrites an existing key.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short identifier, e.g. "client_id"' },
        value: { type: 'string', description: 'Text to remember' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'csv_summary',
    description:
      'Compute one aggregate over a numeric column of a CSV file in the sandbox (header row required). Optional filter keeps only rows where one column equals a value. Returns the exact result.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the CSV file' },
        column: { type: 'string', description: 'Numeric column to aggregate' },
        op: { type: 'string', enum: [...CSV_OPS], description: 'Aggregate to compute' },
        where: {
          type: 'array',
          description: 'Optional filters. A row is kept only if every condition matches (AND)',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              equals: { type: 'string' },
            },
            required: ['column', 'equals'],
          },
        },
      },
      required: ['path', 'column', 'op'],
    },
  },
  
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

/** Result of one tool execution; `ok: false` means the model gets an error payload, not a thrown exception. */
export interface ToolOutcome {
  ok: boolean;
  result: unknown;
}

/** Tool specs for the ids a trial is allowed to use. Unknown ids are ignored. */
export function specsFor(toolIds: readonly string[]): ToolSpec[] {
  return TOOL_SPECS.filter((s) => toolIds.includes(s.name));
}

/** Config-side tool settings used by `resolveToolIds` before intersecting with `task.toolsAllowed`. */
export interface ToolSettings {
  tools: readonly string[];
  memoryEnabled: boolean;
  skillsEnabled: readonly string[];
}

/**
 * The tool ids a trial may use. The config adds tools (core, memory, skill); a task's `toolsAllowed`
 * can only narrow that list, never widen it. Throws on an unknown skill id so a config typo fails loudly.
 */
export function resolveToolIds(settings: ToolSettings, toolsAllowed?: readonly string[]): string[] {
  const fromSkills = settings.skillsEnabled.flatMap((skill) => {
    const tools = SKILL_TOOLS[skill];
    if (!tools) throw new Error(`unknown skill "${skill}" (known: ${Object.keys(SKILL_TOOLS).join(', ')})`);
    return tools;
  });
  const available = [
    ...settings.tools,
    ...(settings.memoryEnabled ? MEMORY_TOOL_NAMES : []),
    ...fromSkills,
  ];
  const unique = [...new Set(available)];
  return toolsAllowed ? unique.filter((t) => toolsAllowed.includes(t)) : unique;
}

/** True for tools that come from a skill (used to emit `skill_invoke` trace events). */
export function isSkillTool(name: string): boolean {
  return SKILL_TOOL_NAMES.includes(name);
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
export async function executeTool(
  sandboxDir: string,
  call: ToolCall,
  memory: MemoryStore = noopMemory,
): Promise<ToolOutcome> {
  const args = call.arguments ?? {};
  let path: string | undefined;
  try {
    switch (call.name) {
      case 'memory_read': {
        const query = requireString(args, 'query');
        const hits = await memory.read(query);
        return { ok: true, result: { query, hits } };
      }
      case 'memory_write': {
        const key = requireString(args, 'key');
        const value = requireString(args, 'value');
        await memory.write(key, value);
        return { ok: true, result: { key } };
      }
      case 'csv_summary': {
        path = requireString(args, 'path');
        const column = requireString(args, 'column');
        const op = requireString(args, 'op') as (typeof CSV_OPS)[number];
        const where = args.where as { column: string; equals: string }[] | undefined;
        if (
          where !== undefined &&
          (!Array.isArray(where) ||
            where.some((c) => typeof c?.column !== 'string' || typeof c?.equals !== 'string'))
        ) {
          throw new Error('where must be a list of {column: string, equals: string}');
        }
        const summary = await csvSummary(sandboxDir, { path, column, op, where });
        return { ok: true, result: summary };
      }
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
