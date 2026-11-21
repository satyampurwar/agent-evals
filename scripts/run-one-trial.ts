/**
 * Run one trial end-to-end: task -> sandbox -> harness -> graders -> trace.json + result.json.
 * The pipeline itself lives in @agent-evals/runner (the API worker uses it too).
 *
 * Usage:
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json --model openrouter:openai/gpt-4.1-mini --harness baseline
 *   npx tsx scripts/run-one-trial.ts tasks/deterministic/02_write_answer.json --script fixtures/scripted/write_answer.json
 *   npx tsx scripts/run-one-trial.ts tasks/discriminating/memory_recall_client_01.json --memory --model openrouter:openai/gpt-4.1-mini
 *   npx tsx scripts/run-one-trial.ts tasks/discriminating/skill_csv_sum_01.json --skill csv_summary --model openrouter:openai/gpt-4.1-mini
 *
 * Config flags (the API reads the same settings from the config document):
 *   --memory                     enable memory_read / memory_write (trial memory starts from task.setup.memory)
 *   --skill <id>                 enable a skill, e.g. csv_summary (repeatable)
 *   --max-tokens <n>             trial token budget, prompt + completion (default 256)
 *
 * Model selection (pick one):
 *   --model <provider:modelId>   e.g. openrouter:openai/gpt-4.1-mini (live), mock:any (offline "42")
 *   --script <responses.json>    replay a fixed ModelResponse[] file (offline)
 *   (neither)                    mock model answering "42"
 *
 * Exit codes: 0 PASS, 1 FAIL (agent answered, graders said no) or TIMEOUT, 2 ERROR (infrastructure).
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskSchema } from '@agent-evals/domain';
import {
  MockModelAdapter,
  ScriptedModelAdapter,
  createModelAdapter,
  parseModelSpec,
} from '@agent-evals/adapters-model';
import type { ModelAdapter, ModelResponse } from '@agent-evals/adapters-model';
import { createHarness, resolveToolIds, TOOL_NAMES } from '@agent-evals/adapters-harness';
import { runTrial } from '@agent-evals/runner';
import { serializeTrace } from '@agent-evals/trace';
import { loadDotEnv } from './lib/env';

interface Args {
  taskPath?: string;
  modelSpec?: string;
  scriptPath?: string;
  harnessId: string;
  memoryEnabled: boolean;
  skillsEnabled: string[];
  maxTokens: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { harnessId: 'baseline', memoryEnabled: false, skillsEnabled: [], maxTokens: 256 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.modelSpec = argv[++i];
    else if (a === '--script') out.scriptPath = argv[++i];
    else if (a === '--harness') out.harnessId = argv[++i];
    else if (a === '--memory') out.memoryEnabled = true;
    else if (a === '--skill') out.skillsEnabled.push(argv[++i]);
    else if (a === '--max-tokens') out.maxTokens = Number(argv[++i]);
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

  // 3. run the trial (fresh sandbox, harness, graders, cleanup)
  const trialId = `trial-${randomUUID()}`;
  const result = await runTrial({
    trialId,
    task,
    harness,
    model,
    modelId,
    modelParams: { temperature: 0 },
    seed: 0,
    budgets: { maxSteps: 10, maxTokens: args.maxTokens, timeoutMs: 60_000 },
    toolIds: resolveToolIds(
      { tools: [...TOOL_NAMES], memoryEnabled: args.memoryEnabled, skillsEnabled: args.skillsEnabled },
      task.toolsAllowed,
    ),
    memorySeed: task.setup?.memory,
  });

  // 4. persist trace + result
  const outDir = join(tmpdir(), 'agent-evals', trialId);
  mkdirSync(outDir, { recursive: true });
  const tracePath = join(outDir, 'trace.json');
  writeFileSync(tracePath, serializeTrace(result.trace));
  const resultPath = join(outDir, 'result.json');
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        trialId,
        taskId: task.id,
        status: result.status,
        passed: result.passed,
        score: result.score,
        stoppedReason: result.stoppedReason,
        harness: harness.id,
        model: { provider, modelId },
        grade: result.grade,
        error: result.error,
        metrics: result.metrics,
        traceUri: tracePath,
      },
      null,
      2,
    ),
  );

  // 5. verdict
  const { metrics } = result;
  if (result.status === 'succeeded') {
    console.log(result.passed ? 'PASS' : 'FAIL');
  } else {
    console.log(`${result.status === 'timeout' ? 'TIMEOUT' : 'ERROR'} (${result.error?.code}): ${result.error?.message}`);
  }
  for (const r of result.grade?.graderResults ?? []) console.log(`  ${r.graderType}: ${r.reasoning}`);
  console.log(`model:   ${provider}:${modelId}`);
  console.log(`harness: ${harness.id}`);
  console.log(`stopped: ${result.stoppedReason ?? 'none'} (steps=${metrics.stepCount})`);
  console.log(
    `usage:   prompt=${metrics.promptTokens} completion=${metrics.completionTokens} total=${metrics.totalTokens}`,
  );
  console.log(`latency: ${metrics.latencyMs} ms`);
  console.log(`trace:   ${tracePath}`);
  console.log(`result:  ${resultPath}`);

  process.exitCode =
    result.status === 'succeeded' ? (result.passed ? 0 : 1) : result.status === 'timeout' ? 1 : 2;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
