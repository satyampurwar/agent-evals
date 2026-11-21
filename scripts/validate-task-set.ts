/**
 * Checks the task set in tasks/ against the Phase 8 rules. Exits 1 on any problem.
 *
 *   npx tsx scripts/validate-task-set.ts
 *
 * Rules:
 * - every task in tasks/manifest.json is valid against the domain TaskSchema
 * - every .json file under tasks/ is listed in the manifest (no orphans)
 * - task ids are unique
 * - at least MIN_TASKS tasks
 * - every grader type in GRADER_TYPES appears at least once
 * - at least one memory-tagged task and one skill-tagged task exist
 * - memory and skill tasks name what they discriminate on (expectedDiscriminators)
 * - toolsAllowed only names tools that exist
 * - state_check graders have at least one check; unit_test graders have a command
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskSchema, type GraderSpec, type Task } from '@agent-evals/domain';
import { TOOL_SPECS } from '@agent-evals/adapters-harness';

const MIN_TASKS = 20;
const GRADER_TYPES: GraderSpec['type'][] = ['exact_match', 'state_check', 'unit_test', 'llm_judge'];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tasksDir = resolve(repoRoot, 'tasks');
const knownTools = new Set(TOOL_SPECS.map((s) => s.name));

interface Manifest {
  tasks: string[];
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
