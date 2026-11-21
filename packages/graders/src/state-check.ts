import { readFile, stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { StateCheck } from '@agent-evals/domain';
import { resolveInSandbox } from '@agent-evals/sandbox';
import type { GraderOutcome } from './exact-match';

export interface StateCheckDetail {
  path: string;
  passed: boolean;
  problems: string[];
}

export interface StateCheckOutcome extends GraderOutcome {
  details: StateCheckDetail[];
}

/** `a.b[0].c` -> walks objects by key and arrays by index. */
function getAtPath(root: unknown, path: string): { found: boolean; value: unknown } {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((t) => t.length > 0);
  let cur: unknown = root;
  for (const key of tokens) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) {
      return { found: false, value: undefined };
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return { found: true, value: cur };
}

async function isRegularFile(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isFile();
  } catch {
    return false;
  }
}

/**
 * Deterministic check of sandbox state after a trial.
 *
 * Per check (all specified fields must hold):
 *  - `exists`: the file is present (or absent, if false)
 *  - `equals`: file content equals this string, after trimming surrounding whitespace on both sides
 *  - `jsonPathEquals`: the file parses as JSON and the value at `path` deep-equals `value`
 *
 * All checks must pass for score 1. Paths are confined to the sandbox.
 */
export async function stateCheck(sandboxDir: string, checks: StateCheck[]): Promise<StateCheckOutcome> {
  const details: StateCheckDetail[] = [];

  for (const check of checks) {
    const problems: string[] = [];
    let abs: string;
    try {
      abs = await resolveInSandbox(sandboxDir, check.path);
    } catch (err) {
      problems.push(`invalid path: ${err instanceof Error ? err.message : String(err)}`);
      details.push({ path: check.path, passed: false, problems });
      continue;
    }

    const exists = await isRegularFile(abs);
    if (check.exists !== undefined && exists !== check.exists) {
      problems.push(`expected exists=${check.exists}, got ${exists}`);
    }

    if (check.equals !== undefined || check.jsonPathEquals !== undefined) {
      if (!exists) {
        problems.push('file missing');
      } else {
        const text = await readFile(abs, 'utf8');
        if (check.equals !== undefined && text.trim() !== check.equals.trim()) {
          problems.push(`expected content ${JSON.stringify(check.equals)}, got ${JSON.stringify(text.trim())}`);
        }
        if (check.jsonPathEquals !== undefined) {
          const { path, value } = check.jsonPathEquals;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            problems.push('file is not valid JSON');
          }
          if (parsed !== undefined) {
            const got = getAtPath(parsed, path);
            if (!got.found) {
              problems.push(`json path not found: ${path}`);
            } else if (!isDeepStrictEqual(got.value, value)) {
              problems.push(`json path ${path}: expected ${JSON.stringify(value)}, got ${JSON.stringify(got.value)}`);
            }
          }
        }
      }
    }

    details.push({ path: check.path, passed: problems.length === 0, problems });
  }

  const passedCount = details.filter((d) => d.passed).length;
  const passed = details.length > 0 && passedCount === details.length;
  const failures = details.flatMap((d) => d.problems.map((p) => `${d.path}: ${p}`));
  return {
    passed,
    score: details.length === 0 ? 0 : passedCount / details.length,
    reasoning: passed
      ? `all ${details.length} state check(s) passed`
      : failures.join('; ') || 'no state checks defined',
    details,
  };
}
