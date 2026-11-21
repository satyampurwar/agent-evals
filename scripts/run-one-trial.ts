/**
 * Run one trial end-to-end: task -> sandbox -> harness -> graders -> trace.json + result.json.
 *
 * Usage:
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json --model openrouter:openai/gpt-4.1-mini --harness baseline
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/02_write_answer.json --script fixtures/scripted/write_answer.json
 *
 * Model selection (pick one):
 *   --model <provider:modelId>   e.g. openrouter:openai/gpt-4.1-mini (live), mock:any (offline "42")
 *   --script <responses.json>    replay a fixed ModelResponse[] file (offline)
 *   (neither)                    mock model answering "42"
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskSchema } from '@agent-evals/domain';
import type { GradeResult } from '@agent-evals/domain';
import {
  MockModelAdapter,
  ScriptedModelAdapter,
  createModelAdapter,
  parseModelSpec,
} from '@agent-evals/adapters-model';
import type { ModelAdapter, ModelResponse } from '@agent-evals/adapters-model';
import { createHarness, noopMemory, TOOL_NAMES } from '@agent-evals/adapters-harness';
import { exactMatch, stateCheck } from '@agent-evals/graders';
import { createSandbox, materializeFiles } from '@agent-evals/sandbox';
import { createTraceBuffer, serializeTrace } from '@agent-evals/trace';
import { loadDotEnv } from './lib/env';

interface Args {
  taskPath?: string;
  modelSpec?: string;
  scriptPath?: string;
  harnessId: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { harnessId: 'baseline' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.modelSpec = argv[++i];
    else if (a === '--script') out.scriptPath = argv[++i];
    else if (a === '--harness') out.harnessId = argv[++i];
    else if (!a.startsWith('--') && out.taskPath === undefined) out.taskPath = a;
  }
  return out;
}

function chooseModel(args: Args): { model: ModelAdapter; provider: string; modelId: string } {
  if (args.modelSpec && args.scriptPath) {
    throw new Error('use either --model or --script, not both');
  }
  if (args.scriptPath) {
    const script = JSON.parse(readFileSync(resolve(args.scriptPath), 'utf8')) as ModelResponse[];
    return { model: new ScriptedModelAdapter(script), provider: 'scripted', modelId: args.scriptPath };
  }
  if (args.modelSpec) {
    const { provider, modelId } = parseModelSpec(args.modelSpec);
    return { model: createModelAdapter(provider), provider, modelId };
  }
  return { model: new MockModelAdapter('42'), provider: 'mock', modelId: '42' };
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.taskPath) {
    console.error(
      'usage: tsx scripts/run-one-trial.ts <task.json> [--model provider:modelId | --script responses.json] [--harness baseline]',
    );
    process.exit(2);
  }

  // 1. load task
  const task = TaskSchema.parse(JSON.parse(readFileSync(resolve(args.taskPath), 'utf8')));

  // 2. model + harness
  const { model, provider, modelId } = chooseModel(args);
  const harness = createHarness(args.harnessId);

  // 3. isolated sandbox for this trial, seeded with the task's setup files
  const trialId = `trial-${randomUUID()}`;
  const sandbox = await createSandbox(trialId);
  const outDir = join(tmpdir(), 'agent-evals', trialId);
  mkdirSync(outDir, { recursive: true });

  try {
    await materializeFiles(sandbox.dir, task.setup?.files);

    // 4. run harness
    const trace = createTraceBuffer();
    const startedAt = Date.now();
    const output = await harness.run({
      task,
      model,
      modelId,
      modelParams: { temperature: 0 },
      context: {
        trialId,
        seed: 0,
        sandboxDir: sandbox.dir,
        budgets: { maxSteps: 10, maxTokens: 256, timeoutMs: 60_000 },
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
    const totalTokens = output.usage.promptTokens + output.usage.completionTokens;
    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          trialId,
          taskId: task.id,
          passed,
          score: grade.score,
          stoppedReason: output.stoppedReason,
          harness: harness.id,
          model: { provider, modelId },
          grade,
          metrics: {
            latencyMs,
            promptTokens: output.usage.promptTokens,
            completionTokens: output.usage.completionTokens,
            totalTokens,
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
    console.log(`model:   ${provider}:${modelId}`);
    console.log(`harness: ${harness.id}`);
    console.log(`stopped: ${output.stoppedReason} (steps=${output.stepCount})`);
    console.log(
      `usage:   prompt=${output.usage.promptTokens} completion=${output.usage.completionTokens} total=${totalTokens}`,
    );
    console.log(`latency: ${latencyMs} ms`);
    console.log(`trace:   ${tracePath}`);
    console.log(`result:  ${resultPath}`);
    process.exitCode = passed ? 0 : 1;
  } finally {
    await sandbox.cleanup();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
