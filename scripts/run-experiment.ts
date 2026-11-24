/**
 * CLI: create configs + experiment, start it, poll until done, write results/.
 *
 * Default plan (memory on vs off, Hermes, full 22-task catalog):
 *   npx tsx scripts/run-experiment.ts --dry-run
 *   npx tsx scripts/run-experiment.ts --name full-catalog --n 3 --configs mem-off,mem-on --tasks all
 *   npx tsx scripts/run-experiment.ts --resume <experimentId>
 *
 * Writes `results/<experimentId>/{compare,export}.{json,csv}`. Needs a running API (`API_URL`, default :3000).
 * The folder is named by experiment id, so two experiments with the same --name never overwrite each other.
 * Write-up: deliverables/EXPERIMENT.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/env';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Task groups selectable via --tasks (comma-separated). Default: all. */
export const GROUPS = {
  all: [
    'det_add_01',
    'det_write_answer_01',
    'det_extract_order_01',
    'det_letter_count_01',
    'det_unit_convert_01',
    'det_weekday_01',
    'det_state_json_01',
    'det_state_nested_01',
    'det_state_multi_01',
    'det_unit_fizzbuzz_01',
    'det_unit_slugify_01',
    'det_unit_roman_01',
    'det_unit_chunk_01',
    'judge_summary_01',
    'judge_explain_01',
    'judge_email_01',
    'judge_bugreport_01',
    'judge_tradeoff_01',
    'mem_recall_client_01',
    'mem_deploy_file_01',
    'skill_csv_sum_01',
    'skill_csv_mean_01',
  ],
  memory: ['mem_recall_client_01', 'mem_deploy_file_01'],
  control: ['det_add_01', 'det_letter_count_01', 'det_weekday_01'],
  judge: ['judge_summary_01', 'judge_explain_01', 'judge_email_01', 'judge_bugreport_01', 'judge_tradeoff_01'],
  skill: ['skill_csv_sum_01', 'skill_csv_mean_01'],
} as const;
type GroupName = keyof typeof GROUPS;

const MODEL = { provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', temperature: 0 };
/** Default tools for a full-catalog run. Override with --tools (comma list) or --tools none. */
const DEFAULT_TOOLS_ALL = ['read_file', 'write_file', 'list_dir'] as const;
const SHARED_SETTINGS = {
  maxSteps: 8,
  maxTokens: 8000,
  timeoutMs: 120_000,
};
const CONFIGS = {
  'mem-off': { memoryEnabled: false },
  'mem-on': { memoryEnabled: true },
} as const;
type ConfigName = keyof typeof CONFIGS;

export const HYPOTHESIS =
  'Memory on (Hermes, gpt-4.1-mini) raises pass rate on memory tasks vs memory off; other tasks should be largely unchanged. See deliverables/EXPERIMENT.md.';

interface Args {
  name: string;
  n: number;
  configs: ConfigName[];
  groups: GroupName[];
  api: string;
  dryRun: boolean;
  resume?: string;
  tools: string[];
  skillsEnabled: string[];
}

/** Config name includes tools/skills so content variants do not collide. */
export function armName(arm: ConfigName, tools: readonly string[], skills: readonly string[] = []): string {
  const parts = [...tools].sort();
  const skillPart = skills.length ? `skills-${[...skills].sort().join('+')}` : '';
  const suffix = [...parts, skillPart].filter(Boolean).join('+');
  return suffix ? `${arm}-${suffix}` : arm;
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
  const name = get('--name') ?? 'full-catalog';
  const n = Number(get('--n') ?? 3);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('--n must be a whole number from 1 to 50');

  const configs = (get('--configs') ?? 'mem-off,mem-on').split(',').map((s) => s.trim()) as ConfigName[];
  for (const c of configs) {
    if (!(c in CONFIGS)) throw new Error(`unknown config "${c}" (known: ${Object.keys(CONFIGS).join(', ')})`);
  }
  if (new Set(configs).size !== 2 || !configs.includes('mem-off') || !configs.includes('mem-on')) {
    throw new Error('--configs must name both mem-off and mem-on (the comparison needs two arms)');
  }

  const groups = (get('--tasks') ?? 'all').split(',').map((s) => s.trim()) as GroupName[];
  for (const g of groups) {
    if (!(g in GROUPS)) throw new Error(`unknown task group "${g}" (known: ${Object.keys(GROUPS).join(', ')})`);
  }

  const api = (get('--api') ?? process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const resume = get('--resume');
  const toolsArg = get('--tools');
  const useAllDefaults = groups.includes('all') && toolsArg === undefined;
  const tools =
    toolsArg === undefined
      ? useAllDefaults
        ? [...DEFAULT_TOOLS_ALL]
        : []
      : toolsArg === 'none'
        ? []
        : toolsArg.split(',').map((s) => s.trim()).filter(Boolean);
  const skillsArg = get('--skills');
  const skillsEnabled =
    skillsArg === undefined
      ? useAllDefaults || groups.includes('skill')
        ? ['csv_summary']
        : []
      : skillsArg === 'none'
        ? []
        : skillsArg.split(',').map((s) => s.trim()).filter(Boolean);
  return { name, n, configs, groups, api, dryRun: argv.includes('--dry-run'), resume, tools, skillsEnabled };
}

export function plannedTaskIds(groups: readonly GroupName[]): string[] {
  return [...new Set(groups.flatMap((g) => [...GROUPS[g]]))];
}

function configBody(arm: ConfigName, tools: readonly string[], skillsEnabled: readonly string[]) {
  return {
    name: armName(arm, tools, skillsEnabled),
    harness: {
      id: 'hermes',
      settings: {
        ...SHARED_SETTINGS,
        skillsEnabled: [...skillsEnabled],
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
    taskCount: taskIds.length,
    tools: args.tools,
    skillsEnabled: args.skillsEnabled,
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
    experimentId = args.resume;
    console.log(`resuming experiment ${experimentId} (no new trials)`);
  } else {
    const created = {} as Record<ConfigName, string>;
    for (const arm of args.configs) {
      const row = await api<ConfigView>(args.api, '/configs', {
        method: 'POST',
        body: JSON.stringify(configBody(arm, args.tools, args.skillsEnabled)),
      });
      created[arm] = row.id;
      console.log(`config ${armName(arm, args.tools, args.skillsEnabled)}: ${row.id}`);
    }

    const experiment = await api<ExperimentView>(args.api, '/experiments', {
      method: 'POST',
      body: JSON.stringify({
        name: args.name,
        hypothesis: HYPOTHESIS,
        taskIds,
        // mem-on first: the API's compare.json treats the first config as A, so its delta matches this CLI's
        configIds: (['mem-on', 'mem-off'] as const).map((c) => created[c]),
        nTrials: args.n,
      }),
    });
    experimentId = experiment.id;
    console.log(`experiment ${experimentId} created (${trialCount} trials)`);

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
    const want = armName(arm, args.tools, args.skillsEnabled);
    const found = exportJson.configs.find((c) => c.name === want);
    if (!found) throw new Error(`config ${want} is not in experiment ${experimentId}`);
    configIds[arm] = found.id;
  }

  // 6. the comparison: A = mem-on, B = mem-off, so the delta is "memory on minus memory off"
  const compare = await api<CompareView>(
    args.api,
    `/experiments/${experimentId}/compare?a=${configIds['mem-on']}&b=${configIds['mem-off']}`,
  );

  const outDir = resolve(repoRoot, 'results', experimentId);
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

  // Per-arm cost, tokens, latency. Prefer OpenRouter list prices for a quick agent-token total;
  // compare.json also reports meanCostUsd (agent + judge) from stored trial metrics.
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
