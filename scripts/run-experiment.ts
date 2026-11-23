/**
 * CLI: drive the pre-registered memory A/B experiment end-to-end via the HTTP API.
 *
 * When to run: after the API, queue worker, and (if using Hermes) Python worker are up, and
 * tasks are seeded. Use `--dry-run` first to print the plan without creating anything.
 * See EXPERIMENT.md for the scientific pre-registration this script implements.
 *
 * What it does: creates/reuses the two configs (mem-off vs mem-on), creates one experiment
 * over the chosen task groups, starts it, polls until terminal status, then writes
 * compare.json / export.json / export.csv under results/<name>/ and prints a summary.
 *
 *   npx tsx scripts/run-experiment.ts --dry-run
 *   npx tsx scripts/run-experiment.ts --name memory-ab --n 10 --configs mem-off,mem-on --tasks memory,control
 *   npx tsx scripts/run-experiment.ts --resume <experimentId>   # re-collect only; starts no trials
 *
 * Task groups and arms are fixed on purpose (pre-registration). Change EXPERIMENT.md and
 * this file together. Env: API_URL (default http://localhost:3000). OPENROUTER_API_KEY is
 * not needed here — the API/worker use it. Cost uses OpenRouter's public model price list.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/env';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The subset from EXPERIMENT.md. Keep these in step with the pre-registration. */
export const GROUPS = {
  memory: ['mem_recall_client_01', 'mem_deploy_file_01'],
  control: ['det_add_01', 'det_letter_count_01', 'det_weekday_01'],
} as const;
type GroupName = keyof typeof GROUPS;

/** The two arms. They differ only in memory.enabled. */
const MODEL = { provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', temperature: 0 };
/**
 * Default: no tools (the pre-registered main run). --tools write_file gives both arms that tool (the labelled
 * post-hoc v2 in EXPERIMENT.md). With tools set, config names get a suffix so they never clash with the originals.
 */
const DEFAULT_TOOLS: string[] = [];
const SHARED_SETTINGS = {
  skillsEnabled: [] as string[],
  maxSteps: 6,
  maxTokens: 8000,
  timeoutMs: 120_000,
};
const CONFIGS = {
  'mem-off': { memoryEnabled: false },
  'mem-on': { memoryEnabled: true },
} as const;
type ConfigName = keyof typeof CONFIGS;

export const HYPOTHESIS =
  'Memory on (Hermes, gpt-4.1-mini) raises the pass rate on memory tasks and leaves control tasks unchanged. See EXPERIMENT.md.';

interface Args {
  name: string;
  n: number;
  configs: ConfigName[];
  groups: GroupName[];
  api: string;
  dryRun: boolean;
  resume?: string;
  tools: string[];
}

/** The config name for an arm. With tools set, the name carries the tool list, so it cannot clash with the original configs. */
export function armName(arm: ConfigName, tools: readonly string[]): string {
  return tools.length ? `${arm}-${[...tools].sort().join('+')}` : arm;
}

interface ConfigView {
  id: string;
  name: string;
}
interface ExperimentView {
  id: string;
  status: string;
}
interface StatusView {
  status: string;
  trials: Record<string, number> & { total: number };
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const name = get('--name') ?? 'memory-ab';
  const n = Number(get('--n') ?? 10);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('--n must be a whole number from 1 to 50');

  const configs = (get('--configs') ?? 'mem-off,mem-on').split(',').map((s) => s.trim()) as ConfigName[];
  for (const c of configs) {
    if (!(c in CONFIGS)) throw new Error(`unknown config "${c}" (known: ${Object.keys(CONFIGS).join(', ')})`);
  }
  if (new Set(configs).size !== 2 || !configs.includes('mem-off') || !configs.includes('mem-on')) {
    throw new Error('--configs must name both mem-off and mem-on (the comparison needs two arms)');
  }

  const groups = (get('--tasks') ?? 'memory,control').split(',').map((s) => s.trim()) as GroupName[];
  for (const g of groups) {
    if (!(g in GROUPS)) throw new Error(`unknown task group "${g}" (known: ${Object.keys(GROUPS).join(', ')})`);
  }

  const api = (get('--api') ?? process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const resume = get('--resume');
  const toolsArg = get('--tools');
  const tools = toolsArg === undefined ? [...DEFAULT_TOOLS] : toolsArg.split(',').map((s) => s.trim()).filter(Boolean);
  return { name, n, configs, groups, api, dryRun: argv.includes('--dry-run'), resume, tools };
}

export function plannedTaskIds(groups: readonly GroupName[]): string[] {
  return [...new Set(groups.flatMap((g) => GROUPS[g]))];
}

function configBody(arm: ConfigName, tools: readonly string[]) {
  return {
    name: armName(arm, tools),
    harness: {
      id: 'hermes',
      settings: {
        ...SHARED_SETTINGS,
        tools: [...tools],
        memory: { enabled: CONFIGS[arm].memoryEnabled, persistAcrossTrials: false },
      },
    },
    model: MODEL,
  };
}

async function api<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function priceList(): Promise<Map<string, { prompt: number; completion: number }>> {
  const prices = new Map<string, { prompt: number; completion: number }>();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    const body = (await res.json()) as { data: { id: string; pricing: { prompt: string; completion: string } }[] };
    for (const m of body.data) {
      prices.set(m.id, { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) });
    }
  } catch {
    // No price list: the run still completes, and cost is reported as unknown.
  }
  return prices;
}

async function main(): Promise<void> {
  loadDotEnv(resolve(repoRoot, '.env'));
  const args = parseArgs(process.argv.slice(2));
  const taskIds = plannedTaskIds(args.groups);
  const trialCount = taskIds.length * args.configs.length * args.n;

  const plan = {
    name: args.name,
    n: args.n,
    configs: args.configs,
    groups: Object.fromEntries(args.groups.map((g) => [g, GROUPS[g]])),
    tools: args.tools,
    trials: trialCount,
    api: args.api,
  };
  console.log(JSON.stringify(plan, null, 2));
  if (args.dryRun) {
    console.log('dry run: nothing was sent to the API.');
    return;
  }

  let experimentId: string;
  if (args.resume) {
    // Re-collect results from an experiment that already exists. Starts no trials.
    experimentId = args.resume;
    console.log(`resuming experiment ${experimentId} (no new trials)`);
  } else {
    // 1. configs (created if new, reused if the same content already exists)
    const created = {} as Record<ConfigName, string>;
    for (const arm of args.configs) {
      const row = await api<ConfigView>(args.api, '/configs', {
        method: 'POST',
        body: JSON.stringify(configBody(arm, args.tools)),
      });
      created[arm] = row.id;
      console.log(`config ${armName(arm, args.tools)}: ${row.id}`);
    }

    // 2. experiment over the chosen tasks, one row per cell per trial
    const experiment = await api<ExperimentView>(args.api, '/experiments', {
      method: 'POST',
      body: JSON.stringify({
        name: args.name,
        hypothesis: args.tools.length
          ? `${HYPOTHESIS} Post-hoc v2: tools [${args.tools.join(', ')}] in both arms (EXPERIMENT.md).`
          : HYPOTHESIS,
        taskIds,
        configIds: args.configs.map((c) => created[c]),
        nTrials: args.n,
      }),
    });
    experimentId = experiment.id;
    console.log(`experiment ${experimentId} created (${trialCount} trials)`);

    // 3. start
    await api(args.api, `/experiments/${experimentId}/start`, { method: 'POST' });
  }

  // 4. poll until a terminal status
  let status: StatusView;
  for (;;) {
    status = await api<StatusView>(args.api, `/experiments/${experimentId}/status`);
    const t = status.trials;
    console.log(
      `${new Date().toISOString()} ${status.status}  total=${t.total} succeeded=${t.succeeded ?? 0} failed=${t.failed ?? 0} timeout=${t.timeout ?? 0} queued=${t.queued ?? 0} running=${t.running ?? 0}`,
    );
    if (['completed', 'partial', 'failed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }

  // 5. exports, then the config ids by name (the export carries each config's name)
  const exportJson = await api<ExportView>(args.api, `/experiments/${experimentId}/export?format=json`);
  const csvRes = await fetch(`${args.api}/experiments/${experimentId}/export?format=csv`);
  const csv = await csvRes.text();
  const configIds = {} as Record<ConfigName, string>;
  for (const arm of args.configs) {
    const found = exportJson.configs.find((c) => c.name === armName(arm, args.tools));
    if (!found) throw new Error(`config ${armName(arm, args.tools)} is not in experiment ${experimentId}`);
    configIds[arm] = found.id;
  }

  // 6. the comparison: A = mem-on, B = mem-off, so the delta is "memory on minus memory off"
  const compare = await api<CompareView>(
    args.api,
    `/experiments/${experimentId}/compare?a=${configIds['mem-on']}&b=${configIds['mem-off']}`,
  );

  const outDir = resolve(repoRoot, 'results', args.name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'compare.json'), JSON.stringify(compare, null, 2));
  writeFileSync(resolve(outDir, 'export.json'), JSON.stringify(exportJson, null, 2));
  writeFileSync(resolve(outDir, 'export.csv'), csv);

  await printSummary({
    experimentId,
    status: status.status,
    compare,
    trials: exportJson.trials,
    configIds,
    outDir,
  });
}

interface ExportView {
  configs: { id: string; name: string; modelId: string }[];
  trials: TrialExport[];
}

/** The fields of a trial row (TrialView) that the summary uses. */
interface TrialExport {
  id: string;
  taskId: string;
  configId: string;
  trialIndex: number;
  status: string;
  passed: boolean | null;
  metrics: { latencyMs?: number; promptTokens?: number; completionTokens?: number } | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

interface CompareView {
  commonTasks: number;
  pairedTrials: number;
  a: { passRate: number; passRateCI: { low: number; high: number }; scoredTrials: number };
  b: { passRate: number; passRateCI: { low: number; high: number }; scoredTrials: number };
  delta: { value: number; ci: { low: number; high: number } | null; pValue: number };
  verdict: string;
  noise: boolean;
  perTask: { taskId: string; passRateA: number; passRateB: number; delta: number }[];
  notes: string[];
}

async function printSummary(input: {
  experimentId: string;
  status: string;
  compare: CompareView;
  trials: TrialExport[];
  configIds: Record<ConfigName, string>;
  outDir: string;
}): Promise<void> {
  const { compare: c } = input;
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const ci = (x: { low: number; high: number } | null) => (x ? `[${pct(x.low)}, ${pct(x.high)}]` : 'n/a');

  console.log('\n=== summary ===');
  console.log(`experiment ${input.experimentId}: ${input.status}`);
  console.log(`mem-on   macro pass rate ${pct(c.a.passRate)}  CI ${ci(c.a.passRateCI)}  (${c.a.scoredTrials} scored trials)`);
  console.log(`mem-off  macro pass rate ${pct(c.b.passRate)}  CI ${ci(c.b.passRateCI)}  (${c.b.scoredTrials} scored trials)`);
  console.log(
    `delta (on - off) ${pct(c.delta.value)}  CI ${ci(c.delta.ci)}  McNemar p=${c.delta.pValue.toFixed(3)}  verdict=${c.verdict}`,
  );
  console.log('\nper task (on - off):');
  for (const t of c.perTask) {
    console.log(`  ${t.taskId.padEnd(24)} on ${pct(t.passRateA).padStart(6)}  off ${pct(t.passRateB).padStart(6)}  delta ${pct(t.delta).padStart(7)}`);
  }

  // Per-arm cost, tokens, latency and stop reasons. Cost is tokens times the OpenRouter list price,
  // because the API does not record a measured cost (estimatedCostUsd stays null).
  const prices = await priceList();
  const modelPrice = prices.get(MODEL.modelId);
  console.log('\nper arm (tokens, cost at list price, mean latency, statuses):');
  for (const name of ['mem-on', 'mem-off'] as const) {
    const rows = input.trials.filter((t) => t.configId === input.configIds[name]);
    const prompt = sum(rows.map((t) => t.metrics?.promptTokens));
    const completion = sum(rows.map((t) => t.metrics?.completionTokens));
    const lat = rows.map((t) => t.metrics?.latencyMs).filter((x): x is number => x !== undefined);
    const cost = modelPrice ? prompt * modelPrice.prompt + completion * modelPrice.completion : null;
    const statuses = countBy(rows.map((t) => `${t.status}${t.error ? `/${t.error.code}` : ''}`));
    console.log(
      `  ${name}: prompt ${prompt}, completion ${completion}, cost ${cost === null ? 'unknown' : `$${cost.toFixed(4)}`}, mean latency ${lat.length ? Math.round(sum(lat) / lat.length) : 'n/a'} ms`,
    );
    console.log(`    statuses: ${JSON.stringify(statuses)}`);
  }
  if (c.notes.length) console.log(`\nnotes: ${c.notes.join(' | ')}`);
  console.log(`\nfiles: ${input.outDir}`);
}

function sum(xs: readonly (number | null | undefined)[]): number {
  return xs.reduce<number>((acc, x) => acc + (x ?? 0), 0);
}

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

// Run only when executed directly (tsx scripts/run-experiment.ts), not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
