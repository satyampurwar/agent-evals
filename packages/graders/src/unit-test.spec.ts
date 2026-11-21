import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unitTest } from './unit-test';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'unit-test-spec-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('unitTest grader', () => {
  it('passes when the command exits 0', async () => {
    await writeFile(join(dir, 'solution.js'), 'module.exports = 2 + 2;');
    const r = await unitTest(dir, "node -e \"require('./solution.js') === 4 ? process.exit(0) : process.exit(1)\"", 5000);
    expect(r).toMatchObject({ passed: true, score: 1, exitCode: 0, timedOut: false });
  });

  it('is a scored failure when the code under test is wrong (non-zero exit)', async () => {
    await writeFile(join(dir, 'solution.js'), 'module.exports = 5;');
    const r = await unitTest(dir, "node -e \"require('./solution.js') === 4 ? process.exit(0) : process.exit(1)\"", 5000);
    expect(r).toMatchObject({ passed: false, score: 0, exitCode: 1, timedOut: false });
    expect(r.reasoning).toContain('exit code 1');
  });

  it('is a scored failure when the command runs past its timeout', async () => {
    const r = await unitTest(dir, "node -e \"setTimeout(() => {}, 10000)\"", 200);
    expect(r).toMatchObject({ passed: false, score: 0, timedOut: true });
    expect(r.reasoning).toContain('timed out');
  });

  it('runs in the sandbox directory', async () => {
    await writeFile(join(dir, 'marker.txt'), 'here');
    const r = await unitTest(dir, 'test -f marker.txt', 5000);
    expect(r.passed).toBe(true);
  });

  it('does not expose the parent environment to the command', async () => {
    process.env.AGENT_EVALS_SECRET_TEST = 'leak';
    try {
      const r = await unitTest(dir, 'test -z "$AGENT_EVALS_SECRET_TEST"', 5000);
      expect(r.passed).toBe(true);
    } finally {
      delete process.env.AGENT_EVALS_SECRET_TEST;
    }
  });
});
