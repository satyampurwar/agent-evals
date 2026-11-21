/**
 * Isolation demo (Phase 4 checkpoint).
 *
 *  Trial A writes secret.txt in its sandbox.
 *  Trial B (fresh sandbox) tries to read it by name, then via a ../ path into A's sandbox.
 *  Both attempts must fail, and B's sandbox must not contain the file.
 *
 * Exits 0 when isolation holds, 1 if B can see A's data.
 * Usage: npx tsx scripts/demo-isolation.ts
 */
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TaskSchema } from '@agent-evals/domain';
import type { Task, TraceEvent } from '@agent-evals/domain';
import { ScriptedModelAdapter } from '@agent-evals/adapters-model';
import type { ModelResponse } from '@agent-evals/adapters-model';
import { BaselineHarness, noopMemory, TOOL_NAMES } from '@agent-evals/adapters-harness';
import { createSandbox } from '@agent-evals/sandbox';
import { createTraceBuffer } from '@agent-evals/trace';

const SECRET = 'A-SECRET-42';

function toolCall(id: string, name: string, args: Record<string, unknown>): ModelResponse {
  return {
    message: { role: 'assistant', content: '', toolCalls: [{ id, name, arguments: args }] },
    usage: { promptTokens: 1, completionTokens: 1 },
  };
}

function reply(content: string): ModelResponse {
  return { message: { role: 'assistant', content }, usage: { promptTokens: 1, completionTokens: 1 } };
}

function makeTask(prompt: string): Task {
  return TaskSchema.parse({ id: 'isolation_demo', version: '1.0.0', name: 'demo', description: 'demo', prompt, graders: [], tags: [] });
}

async function runTrial(trialId: string, sandboxDir: string, prompt: string, script: ModelResponse[]) {
  const trace = createTraceBuffer();
  const output = await new BaselineHarness().run({
    task: makeTask(prompt),
    model: new ScriptedModelAdapter(script),
    modelId: 'scripted',
    modelParams: { temperature: 0 },
    context: {
      trialId,
      seed: 0,
      sandboxDir,
      budgets: { maxSteps: 6, maxTokens: 1000, timeoutMs: 10_000 },
      memory: noopMemory,
      skillIds: [],
      toolIds: [...TOOL_NAMES],
      emit: trace.emit,
    },
  });
  return { output, events: trace.snapshot() as TraceEvent[] };
}

function toolResults(events: TraceEvent[]) {
  return events.filter((e): e is Extract<TraceEvent, { type: 'tool_result' }> => e.type === 'tool_result');
}

async function main() {
  const a = await createSandbox('trial-a');
  const b = await createSandbox('trial-b');
  let ok = true;
  const check = (label: string, pass: boolean, detail = '') => {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!pass) ok = false;
  };

  try {
    console.log(`trial A sandbox: ${a.dir}`);
    console.log(`trial B sandbox: ${b.dir}`);
    console.log('');

    // Trial A writes its secret.
    await runTrial('trial-a', a.dir, 'Store the secret.', [
      toolCall('a1', 'write_file', { path: 'secret.txt', content: SECRET }),
      reply('done'),
    ]);
    check('trial A wrote secret.txt (sanity)', existsSync(join(a.dir, 'secret.txt')));

    // Trial B tries to read the secret by its bare name.
    const runB1 = await runTrial('trial-b', b.dir, 'Read secret.txt.', [
      toolCall('b1', 'read_file', { path: 'secret.txt' }),
      reply('done'),
    ]);
    const b1 = toolResults(runB1.events)[0];
    check('trial B read_file("secret.txt") fails', b1?.ok === false, b1 ? JSON.stringify(b1.result) : 'no tool result');

    // Trial B tries to reach A's sandbox through a relative path.
    const escapeRel = relative(b.dir, join(a.dir, 'secret.txt'));
    const runB2 = await runTrial('trial-b', b.dir, 'Read the other trial file.', [
      toolCall('b2', 'read_file', { path: escapeRel }),
      reply('done'),
    ]);
    const b2 = toolResults(runB2.events)[0];
    check('trial B read_file via ../ into trial A fails', b2?.ok === false, b2 ? JSON.stringify(b2.result) : 'no tool result');

    // Nothing from A reached B's output or trace.
    const leaked = JSON.stringify([runB1.events, runB2.events, runB1.output, runB2.output]).includes(SECRET);
    check('trial A secret does not appear in trial B output or trace', !leaked);

    // B's sandbox holds no copy of the file.
    check("trial B's sandbox has no secret.txt", !existsSync(join(b.dir, 'secret.txt')));
  } finally {
    await a.cleanup();
    await b.cleanup();
  }

  console.log('');
  console.log(ok ? 'ISOLATION OK: trial B could not see trial A data.' : 'ISOLATION FAILED: data leaked between trials.');
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
