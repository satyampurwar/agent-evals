/**
 * CLI: static quality gate for the on-disk task catalog (`tasks/`).
 *
 * When to run: after adding/editing a task JSON, or in CI before merge. Does not need the
 * API running — it only reads files and shared packages.
 *
 * What it does: loads `tasks/manifest.json`, validates each task, and checks Phase-8 catalog
 * rules. Exits 1 on any problem, 0 when the set is OK.
 *
 *   npx tsx scripts/validate-task-set.ts
 *
 * Rules checked:
 * - every manifest entry validates against domain TaskSchema
 * - every .json under tasks/ (except manifest) is listed (no orphans)
 * - unique task ids; at least MIN_TASKS tasks
 * - every grader type in GRADER_TYPES appears at least once
 * - ≥1 memory-tagged and ≥1 skill-tagged task; discriminators listed
 * - toolsAllowed only names known tools; grader fields are complete
 * - every llm_judge model has a price in prices.json
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PriceTableSchema, TaskSchema, type GraderSpec, type PriceTable, type Task } from '@agent-evals/domain';
import { TOOL_SPECS } from '@agent-evals/adapters-harness';
import { getRubric } from '@agent-evals/graders';

const MIN_TASKS = 20;
const GRADER_TYPES: GraderSpec['type'][] = ['exact_match', 'state_check', 'unit_test', 'llm_judge'];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tasksDir = resolve(repoRoot, 'tasks');
const knownTools = new Set(TOOL_SPECS.map((s) => s.name));

interface Manifest {
  tasks: string[];
}

function loadPriceTableFile(): PriceTable {
  const parsed = PriceTableSchema.safeParse(JSON.parse(readFileSync(resolve(repoRoot, 'prices.json'), 'utf8')));
  if (!parsed.success) throw new Error(`prices.json is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  return parsed.data;
}

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(full);
    return entry.name.endsWith('.json') && entry.name !== 'manifest.json' ? [full] : [];
  });
}

function main(): void {
  const problems: string[] = [];
  const manifest = JSON.parse(readFileSync(join(tasksDir, 'manifest.json'), 'utf8')) as Manifest;

  const tasks: Task[] = [];
  for (const rel of manifest.tasks) {
    const raw = JSON.parse(readFileSync(join(tasksDir, rel), 'utf8')) as unknown;
    const parsed = TaskSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(`${rel}: invalid task: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      continue;
    }
    tasks.push(parsed.data);
  }

  const listed = new Set(manifest.tasks.map((rel) => join(tasksDir, rel)));
  for (const file of listJsonFiles(tasksDir)) {
    if (!listed.has(file)) problems.push(`${relative(repoRoot, file)}: not listed in tasks/manifest.json`);
  }

  const seen = new Map<string, number>();
  for (const t of tasks) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) problems.push(`duplicate task id ${id} (${n} times)`);

  if (tasks.length < MIN_TASKS) problems.push(`only ${tasks.length} tasks; need at least ${MIN_TASKS}`);

  const graderCounts = new Map<string, number>();
  for (const t of tasks) {
    for (const g of t.graders) graderCounts.set(g.type, (graderCounts.get(g.type) ?? 0) + 1);
  }
  for (const type of GRADER_TYPES) {
    if (!graderCounts.has(type)) problems.push(`no task uses grader type ${type}`);
  }

  const memoryTasks = tasks.filter((t) => t.tags.includes('memory'));
  const skillTasks = tasks.filter((t) => t.tags.some((tag) => tag.startsWith('skill:')));
  if (memoryTasks.length === 0) problems.push('no task has the memory tag');
  if (skillTasks.length === 0) problems.push('no task has a skill:<id> tag');

  for (const t of memoryTasks) {
    if (!t.expectedDiscriminators?.includes('memory')) {
      problems.push(`${t.id}: memory-tagged task must list "memory" in expectedDiscriminators`);
    }
  }
  for (const t of skillTasks) {
    for (const tag of t.tags.filter((x) => x.startsWith('skill:'))) {
      if (!t.expectedDiscriminators?.includes(tag)) {
        problems.push(`${t.id}: ${tag} tag must also appear in expectedDiscriminators`);
      }
    }
  }

  for (const t of tasks) {
    for (const tool of t.toolsAllowed ?? []) {
      if (!knownTools.has(tool)) problems.push(`${t.id}: toolsAllowed names unknown tool "${tool}"`);
    }
    for (const g of t.graders) {
      if (g.type === 'state_check' && g.checks.length === 0) problems.push(`${t.id}: state_check has no checks`);
      if (g.type === 'unit_test' && g.command.trim() === '') problems.push(`${t.id}: unit_test has an empty command`);
      if (g.type === 'llm_judge' && !getRubric(g.rubricId)) {
        problems.push(`${t.id}: llm_judge names rubric "${g.rubricId}", which does not exist`);
      }
    }
  }

  // Phase 15: a judge model without a list price would fail every trial that grades with it (price_missing).
  const priceTable = loadPriceTableFile();
  for (const t of tasks) {
    for (const g of t.graders) {
      if (g.type === 'llm_judge' && !priceTable.models[g.judgeModel]) {
        problems.push(`${t.id}: judge model "${g.judgeModel}" has no price in prices.json`);
      }
    }
  }

  console.log(`tasks: ${tasks.length} (minimum ${MIN_TASKS})`);
  console.log(`graders: ${GRADER_TYPES.map((type) => `${type}=${graderCounts.get(type) ?? 0}`).join(', ')}`);
  console.log(`memory-tagged: ${memoryTasks.length}, skill-tagged: ${skillTasks.length}`);

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('task set OK');
}

main();
