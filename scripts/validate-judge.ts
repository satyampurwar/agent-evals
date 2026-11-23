/**
 * CLI: measure how well the LLM judge agrees with human labels (Phase 9).
 *
 * When to run: after changing an llm_judge rubric, threshold, or judge model — before trusting
 * that grader in experiments. Needs a live OpenRouter key (OPENROUTER_API_KEY in .env).
 *
 * What it does: for each fixture in fixtures/judge-human-labels/, calls the same llmJudge()
 * the runner uses (rubric / model / threshold from the task), then prints agreement rate,
 * Cohen's kappa, confusion matrix, and every disagreement with reasoning.
 *
 *   npx tsx scripts/validate-judge.ts | tee judge-validation.txt
 *
 * Exit: 0 when kappa >= 0.6 and no setup errors; else 1 (do not ship a weak judge silently).
 * Temperature is 0, but replies are not guaranteed identical across runs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskSchema, type GraderSpec, type Task } from '@agent-evals/domain';
import { createModelAdapter } from '@agent-evals/adapters-model';
import { getRubric, llmJudge, type LlmJudgeOutcome } from '@agent-evals/graders';
import { loadDotEnv } from './lib/env';

loadDotEnv();

const KAPPA_MIN = 0.6;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const labelsDir = resolve(repoRoot, 'fixtures/judge-human-labels');
const tasksDir = resolve(repoRoot, 'tasks');

interface HumanLabel {
  id: string;
  taskId: string;
  answer: string;
  humanPassed: boolean;
  notes: string;
}

type LlmJudgeSpec = Extract<GraderSpec, { type: 'llm_judge' }>;

interface Row {
  label: HumanLabel;
  judgePassed: boolean;
  overall: number;
  failedRequired: string[];
  reasoning: string;
  attempts: number;
}

function loadLabels(): HumanLabel[] {
  const labels = readdirSync(labelsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(labelsDir, f), 'utf8')) as HumanLabel);
  for (const l of labels) {
    if (typeof l.id !== 'string' || typeof l.taskId !== 'string' || typeof l.answer !== 'string') {
      throw new Error(`label ${l.id ?? '?'} is missing id, taskId or answer`);
    }
    if (typeof l.humanPassed !== 'boolean') throw new Error(`label ${l.id} needs humanPassed: true or false`);
  }
  return labels;
}

/** The llm_judge grader of each judge task, looked up by task id (the newest version in the manifest). */
function loadJudgeTasks(): Map<string, { task: Task; grader: LlmJudgeSpec }> {
  const manifest = JSON.parse(readFileSync(join(tasksDir, 'manifest.json'), 'utf8')) as { tasks: string[] };
  const out = new Map<string, { task: Task; grader: LlmJudgeSpec }>();
  for (const rel of manifest.tasks) {
    const task = TaskSchema.parse(JSON.parse(readFileSync(join(tasksDir, rel), 'utf8')));
    const grader = task.graders.find((g): g is LlmJudgeSpec => g.type === 'llm_judge');
    if (grader) out.set(task.id, { task, grader });
  }
  return out;
}

function kappa(rows: Row[]): { agreement: number; kappa: number | null; tp: number; fn: number; fp: number; tn: number } {
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;
  for (const r of rows) {
    if (r.label.humanPassed && r.judgePassed) tp++;
    else if (r.label.humanPassed && !r.judgePassed) fn++;
    else if (!r.label.humanPassed && r.judgePassed) fp++;
    else tn++;
  }
  const n = rows.length;
  const po = (tp + tn) / n;
  const humanPass = (tp + fn) / n;
  const judgePass = (tp + fp) / n;
  const pe = humanPass * judgePass + (1 - humanPass) * (1 - judgePass);
  // When pe is 1 (both raters always say the same thing), kappa is undefined. Report null instead of a fake value.
  const k = pe === 1 ? null : (po - pe) / (1 - pe);
  return { agreement: po, kappa: k, tp, fn, fp, tn };
}

async function main(): Promise<void> {
  const labels = loadLabels();
  const judgeTasks = loadJudgeTasks();
  const adapter = createModelAdapter('openrouter');

  const rows: Row[] = [];
  const errors: string[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };

  for (const label of labels) {
    const judgeTask = judgeTasks.get(label.taskId);
    if (!judgeTask) {
      errors.push(`${label.id}: taskId ${label.taskId} is not a judge task in the manifest`);
      continue;
    }
    const rubric = getRubric(judgeTask.grader.rubricId);
    if (!rubric) {
      errors.push(`${label.id}: rubric ${judgeTask.grader.rubricId} does not exist`);
      continue;
    }
    let r: LlmJudgeOutcome;
    try {
      r = await llmJudge({
        rubric,
        passThreshold: judgeTask.grader.passThreshold,
        taskPrompt: judgeTask.task.prompt,
        answer: label.answer,
        model: adapter,
        modelId: judgeTask.grader.judgeModel,
      });
    } catch (err) {
      errors.push(`${label.id}: judge failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    usage.promptTokens += r.usage.promptTokens;
    usage.completionTokens += r.usage.completionTokens;
    rows.push({ label, judgePassed: r.passed, overall: r.score, failedRequired: r.failedRequired, reasoning: r.reasoning, attempts: r.attempts });
  }

  console.log('Judge validation against human labels');
  console.log(`labels: ${labels.length}, judged: ${rows.length}, judge errors: ${errors.length}`);
  console.log('');

  if (rows.length === 0) {
    for (const e of errors) console.error(e);
    console.error('no labels could be judged');
    process.exit(1);
  }

  const m = kappa(rows);
  console.log(`agreement rate: ${(m.agreement * 100).toFixed(1)}% (${m.tp + m.tn}/${rows.length})`);
  console.log(`Cohen's kappa:  ${m.kappa === null ? 'undefined (both raters gave one answer to every label)' : m.kappa.toFixed(3)}`);
  console.log('');
  console.log('confusion matrix (rows = human, columns = judge; positive = passed)');
  console.log('                 judge pass  judge fail');
  console.log(`  human pass     ${String(m.tp).padStart(10)}  ${String(m.fn).padStart(10)}`);
  console.log(`  human fail     ${String(m.fp).padStart(10)}  ${String(m.tn).padStart(10)}`);
  console.log('');

  const byTask = new Map<string, Row[]>();
  for (const r of rows) byTask.set(r.label.taskId, [...(byTask.get(r.label.taskId) ?? []), r]);
  console.log('per task');
  for (const [taskId, rs] of [...byTask.entries()].sort()) {
    const t = kappa(rs);
    const k = t.kappa === null ? 'n/a' : t.kappa.toFixed(2);
    console.log(`  ${taskId.padEnd(20)} n=${String(rs.length).padStart(2)} agreement=${(t.agreement * 100).toFixed(0)}% kappa=${k}`);
  }
  console.log('');

  const disagreements = rows.filter((r) => r.judgePassed !== r.label.humanPassed);
  console.log(`disagreements: ${disagreements.length}`);
  for (const r of disagreements) {
    console.log(`- ${r.label.id} ${r.label.taskId}: human=${r.label.humanPassed ? 'pass' : 'fail'}, judge=${r.judgePassed ? 'pass' : 'fail'} (overall ${r.overall.toFixed(2)}${r.failedRequired.length ? `, unmet required: ${r.failedRequired.join(', ')}` : ''})`);
    console.log(`    label note: ${r.label.notes}`);
    console.log(`    judge: ${r.reasoning}`);
  }
  console.log('');
  console.log(`judge tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens}`);

  if (errors.length > 0) {
    console.log('');
    console.log('errors:');
    for (const e of errors) console.log(`- ${e}`);
  }

  const pass = m.kappa !== null && m.kappa >= KAPPA_MIN;
  console.log('');
  console.log(
    pass
      ? `verdict: kappa >= ${KAPPA_MIN}, the judge is acceptable on this set`
      : `verdict: kappa below ${KAPPA_MIN}. Tighten the rubric or change the judge model, then re-run. Do not ship this judge.`,
  );
  process.exit(pass && errors.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
