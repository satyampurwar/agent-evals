import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stateCheck } from './state-check';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'state-spec-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('stateCheck', () => {
  it('passes when the file exists with the expected content (whitespace-trimmed)', async () => {
    await writeFile(join(dir, 'answer.txt'), 'ok\n');
    const r = await stateCheck(dir, [{ path: 'answer.txt', exists: true, equals: 'ok' }]);
    expect(r).toMatchObject({ passed: true, score: 1 });
  });

  it('fails with a readable reason when content differs', async () => {
    await writeFile(join(dir, 'answer.txt'), 'nope');
    const r = await stateCheck(dir, [{ path: 'answer.txt', equals: 'ok' }]);
    expect(r.passed).toBe(false);
    expect(r.reasoning).toContain('answer.txt: expected content "ok", got "nope"');
  });

  it('fails when the file is missing and content is required', async () => {
    const r = await stateCheck(dir, [{ path: 'answer.txt', equals: 'ok' }]);
    expect(r.passed).toBe(false);
    expect(r.reasoning).toContain('file missing');
  });

  it('checks absence with exists: false', async () => {
    expect((await stateCheck(dir, [{ path: 'gone.txt', exists: false }])).passed).toBe(true);
    await writeFile(join(dir, 'gone.txt'), 'x');
    expect((await stateCheck(dir, [{ path: 'gone.txt', exists: false }])).passed).toBe(false);
  });

  it('checks a value at a JSON path, including array indexes', async () => {
    await writeFile(join(dir, 'out.json'), JSON.stringify({ result: { items: [{ id: 7 }] } }));
    const pass = await stateCheck(dir, [{ path: 'out.json', jsonPathEquals: { path: 'result.items[0].id', value: 7 } }]);
    expect(pass.passed).toBe(true);
    const fail = await stateCheck(dir, [{ path: 'out.json', jsonPathEquals: { path: 'result.items[0].id', value: 8 } }]);
    expect(fail.passed).toBe(false);
    const missing = await stateCheck(dir, [{ path: 'out.json', jsonPathEquals: { path: 'nope', value: 1 } }]);
    expect(missing.reasoning).toContain('json path not found: nope');
  });

  it('reports invalid JSON as a failure', async () => {
    await writeFile(join(dir, 'bad.json'), '{not json');
    const r = await stateCheck(dir, [{ path: 'bad.json', jsonPathEquals: { path: 'a', value: 1 } }]);
    expect(r.reasoning).toContain('not valid JSON');
  });

  it('gives partial score when only some checks pass', async () => {
    await writeFile(join(dir, 'a.txt'), 'ok');
    const r = await stateCheck(dir, [
      { path: 'a.txt', equals: 'ok' },
      { path: 'b.txt', exists: true },
    ]);
    expect(r).toMatchObject({ passed: false, score: 0.5 });
  });

  it('refuses paths that escape the sandbox or go through symlinks', async () => {
    const box = join(dir, 'box');
    await mkdir(box);
    await writeFile(join(dir, 'secret.txt'), 'S');
    await symlink(join(dir, 'secret.txt'), join(box, 'link.txt'));

    const escape = await stateCheck(box, [{ path: '../secret.txt', equals: 'S' }]);
    expect(escape.passed).toBe(false);
    expect(escape.reasoning).toContain('escapes sandbox');

    const viaLink = await stateCheck(box, [{ path: 'link.txt', equals: 'S' }]);
    expect(viaLink.passed).toBe(false);
    expect(viaLink.reasoning).toContain('symlinks are not allowed');
  });
});
