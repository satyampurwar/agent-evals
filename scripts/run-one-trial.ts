/**
 * Run one trial end-to-end: task -> sandbox -> baseline harness -> graders -> trace.json + result.json.
 *
 * Usage:
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/02_write_answer.json --script fixtures/scripted/write_answer.json
 *
 * Without --script the mock model answers "42" and makes no tool calls.
 * With --script the model replays the given ModelResponse[] JSON file.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskSchema } from '@agent-evals/domain';
import type { GradeResult } from '@agent-evals/domain';
import { MockModelAdapter, ScriptedModelAdapter } from '@agent-evals/adapters-model';
import type { ModelAdapter, ModelResponse } from '@agent-evals/adapters-model';
import { BaselineHarness, noopMemory, TOOL_NAMES } from '@agent-evals/adapters-harness';
import { exactMatch, stateCheck } from '@agent-evals/graders';
import { createSandbox, materializeFiles } from '@agent-evals/sandbox';
import { createTraceBuffer, serializeTrace } from '@agent-evals/trace';

function parseArgs(argv: string[]): { taskPath?: string; scriptPath?: string } {
  const out: { taskPath?: string; scriptPath?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--script') {
      out.scriptPath = argv[++i];
    } else if (!a.startsWith('--') && out.taskPath === undefined) {
      out.taskPath = a;
    }
  }
  return out;
}

async function main() {
  const { taskPath, scriptPath } = parseArgs(process.argv.slice(2));
  if (!taskPath) {
    console.error('usage: tsx scripts/run-one-trial.ts <task.json> [--script <responses.json>]');
    process.exit(2);
  }

  // 1. load task
  const task = TaskSchema.parse(JSON.parse(readFileSync(resolve(taskPath), 'utf8')));

  // 2. model
  let model: ModelAdapter;
  let modelId: string;
  if (scriptPath) {
    const script = JSON.parse(readFileSync(resolve(scriptPath), 'utf8')) as ModelResponse[];
    model = new ScriptedModelAdapter(script);
    modelId = `scripted:${scriptPath}`;
  } else {
    model = new MockModelAdapter('42');
    modelId = 'mock/42';
  }

  // 3. isolated sandbox for this trial, seeded with the task's setup files
  const trialId = `trial-${randomUUID()}`;
  const sandbox = await createSandbox(trialId);
  const outDir = join(tmpdir(), 'agent-evals', trialId);
  mkdirSync(outDir, { recursive: true });

  try {
    await materializeFiles(sandbox.dir, task.setup?.files);

    // 4. run baseline harness
    const trace = createTraceBuffer();
    const startedAt = Date.now();
    const output = await new BaselineHarness().run({
      task,
      model,
      modelId,
      modelParams: { temperature: 0 },
      context: {
        trialId,
        seed: 0,
        sandboxDir: sandbox.dir,
        budgets: { maxSteps: 10, maxTokens: 256, timeoutMs: 10_000 },
        memory: noopMemory,
        skillIds: [],
        toolIds: task.toolsAllowed ?? [...TOOL_NAMES],
        emit: trace.emit,
      },
    });
    const latencyMs = Date.now() - startedAt;

    // 5. grade (state checks read the sandbox, so run before cleanup)
    const graderResults: GradeResult['graderResults'] = [];
    for (const g of task.graders) {
      if (g.type === 'exact_match') {
        const r = exactMatch(output.finalAnswer, g.expected, g.normalize);
        graderResults.push({ graderType: g.type, passed: r.passed, score: r.score, reasoning: r.reasoning });
      } else if (g.type === 'state_check') {
        const r = await stateCheck(sandbox.dir, g.checks);
        graderResults.push({
          graderType: g.type,
          passed: r.passed,
          score: r.score,
          reasoning: r.reasoning,
          details: { checks: r.details },
        });
      } else {
        throw new Error(`grader "${(g as { type: string }).type}" is not implemented yet`);
      }
    }
    const passed = graderResults.every((r) => r.passed);
    const grade: GradeResult = {
      passed,
      score: passed ? 1 : 0,
      graderResults,
      aggregatePolicy: 'all_must_pass',
    };

    // 6. persist trace + result, print verdict
    const tracePath = join(outDir, 'trace.json');
    writeFileSync(
      tracePath,
      serializeTrace({ trialId, events: trace.snapshot(), finalAnswer: output.finalAnswer }),
    );
    const resultPath = join(outDir, 'result.json');
    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          trialId,
          taskId: task.id,
          passed,
          score: grade.score,
          stoppedReason: output.stoppedReason,
          grade,
          metrics: {
            latencyMs,
            promptTokens: output.usage.promptTokens,
            completionTokens: output.usage.completionTokens,
            totalTokens: output.usage.promptTokens + output.usage.completionTokens,
            stepCount: output.stepCount,
          },
          traceUri: tracePath,
        },
        null,
        2,
      ),
    );

    console.log(passed ? 'PASS' : 'FAIL');
    for (const r of graderResults) console.log(`  ${r.graderType}: ${r.reasoning}`);
    console.log(`stopped: ${output.stoppedReason} (steps=${output.stepCount})`);
    console.log(`trace:  ${tracePath}`);
    console.log(`result: ${resultPath}`);
    process.exitCode = passed ? 0 : 1;
  } finally {
    await sandbox.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
