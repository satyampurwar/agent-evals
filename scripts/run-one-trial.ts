/**
 * Run one fake trial end-to-end: task -> sandbox -> baseline harness (mock model)
 * -> exact_match grader -> trace.json + result.json.
 *
 * Usage: npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TaskSchema } from '@agent-evals/domain';
import type { GradeResult } from '@agent-evals/domain';
import { MockModelAdapter } from '@agent-evals/adapters-model';
import { BaselineHarness, noopMemory } from '@agent-evals/adapters-harness';
import { exactMatch } from '@agent-evals/graders';
import { createTraceBuffer, serializeTrace } from '@agent-evals/trace';

async function main() {
  const taskPath = process.argv[2];
  if (!taskPath) {
    console.error('usage: tsx scripts/run-one-trial.ts <task.json>');
    process.exit(2);
  }

  // 1. load task
  const task = TaskSchema.parse(JSON.parse(readFileSync(resolve(taskPath), 'utf8')));

  // 2. isolated temp sandbox + output dir
  const trialId = `trial-${randomUUID()}`;
  const sandboxDir = mkdtempSync(join(tmpdir(), 'agent-evals-sandbox-'));
  const outDir = join(tmpdir(), 'agent-evals', trialId);
  mkdirSync(outDir, { recursive: true });

  // 3. run baseline harness with mock model
  const trace = createTraceBuffer();
  const startedAt = Date.now();
  const output = await new BaselineHarness().run({
    task,
    model: new MockModelAdapter('42'),
    modelId: 'mock/42',
    modelParams: { temperature: 0 },
    context: {
      trialId,
      seed: 0,
      sandboxDir,
      budgets: { maxSteps: 1, maxTokens: 256, timeoutMs: 10_000 },
      memory: noopMemory,
      skillIds: [],
      toolIds: [],
      emit: trace.emit,
    },
  });
  const latencyMs = Date.now() - startedAt;

  // 4. grade
  const graderResults: GradeResult['graderResults'] = task.graders.map((g) => {
    if (g.type !== 'exact_match') {
      throw new Error(`grader "${g.type}" is not implemented yet`);
    }
    const r = exactMatch(output.finalAnswer, g.expected, g.normalize);
    return { graderType: g.type, passed: r.passed, score: r.score, reasoning: r.reasoning };
  });
  const passed = graderResults.every((r) => r.passed);
  const grade: GradeResult = {
    passed,
    score: passed ? 1 : 0,
    graderResults,
    aggregatePolicy: 'all_must_pass',
  };

  // 5. persist trace + result, print verdict
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
  console.log(`trace:  ${tracePath}`);
  console.log(`result: ${resultPath}`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
