/**
 * Unit-test grader — run a shell command in the sandbox and treat exit 0 as pass.
 *
 * Use when the agent should produce code or data that a script can verify (e.g. `python test.py`).
 * The command runs with `cwd` = sandbox and a minimal env (PATH only), so host API keys are not
 * leaked into the child process.
 */

import { execFile } from 'node:child_process';
import type { GraderOutcome } from './exact-match.js';

export interface UnitTestOutcome extends GraderOutcome {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

const MAX_OUTPUT_CHARS = 2000;

function tail(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `...${text.slice(-MAX_OUTPUT_CHARS)}` : text;
}

/**
 * Runs `command` through `sh -c` with the sandbox as the working directory.
 *
 * - exit 0 -> passed (score 1)
 * - non-zero exit or timeout -> scored failure (score 0): the agent's code did not satisfy the test
 *
 * The child gets a minimal environment (PATH only), so API keys in the API process are not visible to it.
 * Tasks are authored by us, so the command is trusted; the sandbox limits where files land, not what the command can do.
 */
export function unitTest(sandboxDir: string, command: string, timeoutMs: number): Promise<UnitTestOutcome> {
  return new Promise((resolve) => {
    execFile(
      'sh',
      ['-c', command],
      {
        cwd: sandboxDir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH ?? '' },
      },
      (err, stdout, stderr) => {
        const output = tail(`${stdout}${stderr}`.trim());
        if (!err) {
          resolve({
            passed: true,
            score: 1,
            exitCode: 0,
            timedOut: false,
            output,
            reasoning: `command passed: ${command}`,
          });
          return;
        }

        // execFile sets `killed` when the timeout fired; `code` is a number for ordinary non-zero exits.
        const timedOut = err.killed === true && err.signal !== null;
        const exitCode = typeof err.code === 'number' ? err.code : null;
        const why = timedOut ? `timed out after ${timeoutMs} ms` : `exit code ${exitCode ?? 'unknown'}`;
        resolve({
          passed: false,
          score: 0,
          exitCode,
          timedOut,
          output,
          reasoning: `command failed (${why}): ${command}${output ? `\n${output}` : ''}`,
        });
      },
    );
  });
}
