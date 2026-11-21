/**
 * Checkpoint 10 fixtures for the comparison statistics.
 *
 *   npx tsx scripts/stats-fixtures.ts             check both fixtures (exit 0 when both behave as expected)
 *   npx tsx scripts/stats-fixtures.ts --generate  rewrite fixtures/stats/*.json from the seeds below
 *
 * known_gap: A passes ~90% of trials, B ~40%. The gap is real, so the comparison should call A better.
 * coin_flip: both sides pass ~50% at random. Any difference is noise, so the comparison should say so.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareConfigs, mulberry32, type CompareResult, type SideInput } from '@agent-evals/stats';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'fixtures/stats');

interface Outcome {
  taskId: string;
  trialIndex: number;
  a: boolean;
  b: boolean;
}

interface Fixture {
  name: string;
  description: string;
  generator: { seed: number; tasks: number; trialsPerTask: number; pA: number; pB: number };
  outcomes: Outcome[];
}

const SPECS: Record<string, Omit<Fixture, 'outcomes'>> = {
  known_gap: {
    name: 'known_gap',
    description: 'A passes ~90% of trials and B ~40%, on 20 tasks with 5 trials each. A real gap of this size must be significant.',
    generator: { seed: 101, tasks: 20, trialsPerTask: 5, pA: 0.9, pB: 0.4 },
  },
  coin_flip: {
    name: 'coin_flip',
    description: 'A and B both pass ~50% of trials at random, on 20 tasks with 5 trials each. Any difference here is noise.',
    generator: { seed: 202, tasks: 20, trialsPerTask: 5, pA: 0.5, pB: 0.5 },
  },
};

function generate(spec: Omit<Fixture, 'outcomes'>): Fixture {
  const { seed, tasks, trialsPerTask, pA, pB } = spec.generator;
  const rand = mulberry32(seed);
  const outcomes: Outcome[] = [];
  for (let t = 0; t < tasks; t++) {
    const taskId = `task_${String(t + 1).padStart(2, '0')}`;
    for (let trialIndex = 0; trialIndex < trialsPerTask; trialIndex++) {
      outcomes.push({ taskId, trialIndex, a: rand() < pA, b: rand() < pB });
    }
  }
  return { ...spec, outcomes };
}

function sides(f: Fixture): { a: SideInput; b: SideInput } {
  const none = { failed: 0, cancelled: 0, pending: 0 };
  const toTrials = (pick: 'a' | 'b') =>
    f.outcomes.map((o) => ({ taskId: o.taskId, trialIndex: o.trialIndex, passed: o[pick] }));
  return {
    a: { configId: 'A', trials: toTrials('a'), excluded: none },
    b: { configId: 'B', trials: toTrials('b'), excluded: none },
  };
}

function summary(name: string, r: CompareResult): string {
  const ci = r.delta.ci ? `[${r.delta.ci.low.toFixed(3)}, ${r.delta.ci.high.toFixed(3)}]` : 'n/a';
  return [
    `${name}`,
    `  macro pass rate  A ${r.a.passRate.toFixed(3)}  B ${r.b.passRate.toFixed(3)}  delta ${r.delta.value.toFixed(3)}`,
    `  delta 95% CI     ${ci}`,
    `  McNemar p        ${r.delta.pValue.toFixed(4)}  (discordant A-only ${r.delta.discordant.aOnly}, B-only ${r.delta.discordant.bOnly})`,
    `  verdict          ${r.verdict}  noise=${r.noise}`,
  ].join('\n');
}

function check(name: string, r: CompareResult): boolean {
  if (name === 'known_gap') {
    return r.verdict === 'a_better' && r.delta.ci !== null && r.delta.ci.low > 0 && r.delta.pValue < 0.05;
  }
  return r.verdict === 'likely_noise' && r.noise;
}

if (process.argv.includes('--generate')) {
  mkdirSync(dir, { recursive: true });
  for (const spec of Object.values(SPECS)) {
    const file = resolve(dir, `${spec.name}.json`);
    writeFileSync(file, `${JSON.stringify(generate(spec), null, 2)}\n`);
    console.log(`wrote ${file}`);
  }
  process.exit(0);
}

let ok = true;
for (const name of Object.keys(SPECS)) {
  const fixture = JSON.parse(readFileSync(resolve(dir, `${name}.json`), 'utf8')) as Fixture;
  const { a, b } = sides(fixture);
  const r = compareConfigs(a, b, { seed: 1 });
  console.log(summary(name, r));
  const pass = check(name, r);
  console.log(`  expected         ${pass ? 'OK' : 'NOT AS EXPECTED'}\n`);
  ok &&= pass;
}
process.exit(ok ? 0 : 1);
