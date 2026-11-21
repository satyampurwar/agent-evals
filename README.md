# agent-evals

Command log from an empty directory to the current tree: npm workspaces (NestJS API, Vue UI), a `uv` Python worker, Docker Compose for Postgres and Redis, and `@agent-evals/domain` Zod schemas.

Working copy: `/Users/turing-satyam/work/beyond/task/agent-evals`.

`.env` stays untracked. Do not commit it.

---

## Phase 1 — Scaffold

### 1.1 npm workspace

```bash
cd /Users/turing-satyam/work/beyond/task
mkdir -p agent-evals
cd agent-evals
git init
npm init -y
```

Replace `package.json` with:

```json
{
  "name": "agent-evals",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*",
    "workers/node-worker"
  ],
  "scripts": {
    "dev:api": "npm run start:dev -w @agent-evals/api",
    "dev:web": "npm run dev -w @agent-evals/web",
    "dev:worker:node": "npm run start -w @agent-evals/node-worker",
    "dev:worker:python": "cd workers/python-worker && uv run uvicorn app.main:app --reload --port 8001",
    "test": "npm run test --workspaces --if-present",
    "seed:tasks": "npx tsx scripts/seed-tasks.ts"
  }
}
```

`workers/python-worker` is not an npm workspace.

### 1.2 Folders

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals

mkdir -p apps packages workers tasks scripts fixtures/judge-human-labels tests
mkdir -p packages/domain/src \
         packages/adapters-model/src \
         packages/adapters-harness/src \
         packages/graders/src \
         packages/stats/src \
         packages/trace/src
mkdir -p workers/node-worker/src
mkdir -p workers/python-worker/app
mkdir -p tasks/deterministic tasks/judge tasks/discriminating
```

### 1.2b Python worker (`uv`, Python 3.12)

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals/workers/python-worker
uv init --name agent-evals-python-worker --package
```

`uv init` wrote `requires-python = ">=3.13"`, so `uv python pin 3.12` failed. Set `requires-python` to `>=3.12` in `pyproject.toml`, then:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals/workers/python-worker
printf '3.12\n' > .python-version
uv python install 3.12
uv python pin 3.12
uv sync
uv add fastapi uvicorn httpx pydantic pydantic-settings
uv add --dev pytest ruff
uv run python -c "import fastapi; print('python worker ok', fastapi.__version__)"
```

Repo root `.gitignore`:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
cat > .gitignore <<'EOF'
.env
node_modules
dist
.venv/
**/__pycache__/
.pytest_cache/
.ruff_cache/
*.egg-info/
pgdata/
EOF
```

`workers/python-worker/app/main.py`:

```python
from fastapi import FastAPI

app = FastAPI(title="agent-evals-python-worker")

@app.get("/health")
def health():
    return {"ok": True, "worker": "python"}
```

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals/workers/python-worker
uv run uvicorn app.main:app --reload --port 8001
```

Other terminal:

```bash
curl -s http://localhost:8001/health
# {"ok":true,"worker":"python"}
```

Stop uvicorn with Ctrl+C.

### 1.3 NestJS API

The first `npx @nestjs/cli new` failed on a root-owned `~/.npm` cache (`EACCES` / `EEXIST`). The scaffold that landed used a user-owned cache:

```bash
export npm_config_cache="/Users/turing-satyam/.npm-cache-user"
mkdir -p "$npm_config_cache"
npm config set cache "$npm_config_cache"

cd /Users/turing-satyam/work/beyond/task/agent-evals
npx --yes @nestjs/cli@12 new api --directory apps/api --package-manager npm --skip-git --strict
```

CLI wrote `"name": "api"`. Change it to the workspace name:

```bash
# apps/api/package.json
# "name": "api"  ->  "name": "@agent-evals/api"
```

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
npm install
npm run start:dev -w @agent-evals/api
```

Other terminal:

```bash
curl -s http://localhost:3000
```

Stop the API with Ctrl+C.

### 1.4 Vue 3 UI

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
npm create vite@latest apps/web -- --template vue-ts
```

CLI wrote `"name": "web"`. Change it to:

```bash
# apps/web/package.json
# "name": "web"  ->  "name": "@agent-evals/web"
```

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
npm install
npm run dev -w @agent-evals/web
```

Open the Vite URL (usually `http://localhost:5173`). Stop with Ctrl+C.

### 1.5 Docker Compose

`docker-compose.yml` (as created in this phase; Phase 6 changed the `db` ports line to `"${POSTGRES_HOST_PORT:-5432}:5432"`, see 6.2):

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: evals
      POSTGRES_PASSWORD: evals
      POSTGRES_DB: evals
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7
    ports: ["6379:6379"]

volumes:
  pgdata:
```

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals

cp /Users/turing-satyam/work/beyond/task/secrets/keys.env .env
cat >> .env <<'EOF'
DATABASE_URL=postgres://evals:evals@localhost:5432/evals
REDIS_URL=redis://localhost:6379
JUDGE_MODEL=openai/gpt-4.1-mini
EOF

cat > .env.example <<'EOF'
OPENROUTER_API_KEY=
DATABASE_URL=postgres://evals:evals@localhost:5432/evals
REDIS_URL=redis://localhost:6379
JUDGE_MODEL=openai/gpt-4.1-mini
EOF

docker compose up -d db redis
docker compose ps
```

### Checkpoint 1

API on `:3000`, Vue on `:5173`, `curl http://localhost:8001/health` via `uv run`, Postgres and Redis healthy.

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
git add .gitignore .env.example docker-compose.yml package.json package-lock.json apps workers
git commit -m "Initial scaffold for agent evals platform."
```

---

## Phase 2 — Domain schemas

Shapes match `implementation.md` §5. Types are inferred from the Zod schemas.

### 2.1 Package

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
mkdir -p packages/domain/src/__tests__/fixtures
```

`packages/domain/package.json`:

```json
{
  "name": "@agent-evals/domain",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run"
  }
}
```

`packages/domain/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

`packages/domain/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{spec,test}.ts'],
  },
});
```

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals

cat > packages/domain/src/schemas.ts <<'EOF'
import { z } from 'zod';

/**
 * Domain shapes from implementation.md §5.
 * Zod is the single source; inferred types match those interfaces.
 */

export const TaskIdSchema = z.string();
export const ConfigIdSchema = z.string();
export const ExperimentIdSchema = z.string();
export const TrialIdSchema = z.string();

export type TaskId = z.infer<typeof TaskIdSchema>;
export type ConfigId = z.infer<typeof ConfigIdSchema>;
export type ExperimentId = z.infer<typeof ExperimentIdSchema>;
export type TrialId = z.infer<typeof TrialIdSchema>;

export const StateCheckSchema = z.object({
  path: z.string(),
  exists: z.boolean().optional(),
  equals: z.string().optional(),
  jsonPathEquals: z
    .object({
      path: z.string(),
      value: z.unknown(),
    })
    .optional(),
});

export type StateCheck = z.infer<typeof StateCheckSchema>;

export const GraderSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('exact_match'),
    field: z.literal('final_answer'),
    expected: z.string(),
    normalize: z.literal('trim_lower').optional(),
  }),
  z.object({
    type: z.literal('unit_test'),
    command: z.string(),
    timeoutMs: z.number(),
  }),
  z.object({
    type: z.literal('state_check'),
    checks: z.array(StateCheckSchema),
  }),
  z.object({
    type: z.literal('llm_judge'),
    rubricId: z.string(),
    judgeModel: z.string(),
    passThreshold: z.number(),
  }),
]);

export type GraderSpec = z.infer<typeof GraderSpecSchema>;

export const TaskSetupSchema = z.object({
  files: z.record(z.string(), z.string()).optional(),
  seed: z.number().optional(),
});

export type TaskSetup = z.infer<typeof TaskSetupSchema>;

export const TaskSchema = z.object({
  id: TaskIdSchema,
  version: z.string(),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  setup: TaskSetupSchema.optional(),
  toolsAllowed: z.array(z.string()).optional(),
  graders: z.array(GraderSpecSchema),
  tags: z.array(z.string()),
  expectedDiscriminators: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type Task = z.infer<typeof TaskSchema>;

export const ConfigSchema = z.object({
  id: ConfigIdSchema,
  name: z.string(),
  version: z.number(),
  harness: z.object({
    id: z.string(),
    settings: z.object({
      skillsEnabled: z.array(z.string()),
      memory: z.object({
        enabled: z.boolean(),
        persistAcrossTrials: z.boolean(),
        maxItems: z.number().optional(),
      }),
      tools: z.array(z.string()),
      maxSteps: z.number(),
      maxTokens: z.number(),
      timeoutMs: z.number(),
    }),
  }),
  model: z.object({
    provider: z.string(),
    modelId: z.string(),
    temperature: z.number(),
    topP: z.number().optional(),
  }),
  contentHash: z.string(),
  createdAt: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const ExperimentSchema = z.object({
  id: ExperimentIdSchema,
  name: z.string(),
  hypothesis: z.string().optional(),
  taskIds: z.array(TaskIdSchema),
  configIds: z.array(ConfigIdSchema),
  nTrials: z.number(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'partial']),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});

export type Experiment = z.infer<typeof ExperimentSchema>;

export const GradeResultSchema = z.object({
  passed: z.boolean(),
  score: z.number(),
  graderResults: z.array(
    z.object({
      graderType: z.string(),
      passed: z.boolean(),
      score: z.number(),
      reasoning: z.string().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  aggregatePolicy: z.enum(['all_must_pass', 'weighted_mean']),
});

export type GradeResult = z.infer<typeof GradeResultSchema>;

export const TrialSchema = z.object({
  id: TrialIdSchema,
  experimentId: ExperimentIdSchema,
  taskId: TaskIdSchema,
  configId: ConfigIdSchema,
  configContentHash: z.string(),
  trialIndex: z.number(),
  status: z.enum([
    'queued',
    'running',
    'succeeded',
    'failed',
    'timeout',
    'cancelled',
  ]),
  seed: z.number(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  metrics: z.object({
    latencyMs: z.number(),
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
    estimatedCostUsd: z.number(),
    stepCount: z.number(),
  }),
  grade: GradeResultSchema.optional(),
  traceUri: z.string(),
});

export type Trial = z.infer<typeof TrialSchema>;

export const TraceEventSchema = z.discriminatedUnion('type', [
  z.object({
    ts: z.string(),
    type: z.literal('message'),
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.unknown(),
    callId: z.string(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('tool_result'),
    callId: z.string(),
    ok: z.boolean(),
    result: z.unknown(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('memory_read'),
    query: z.string(),
    hits: z.array(z.unknown()),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('memory_write'),
    key: z.string(),
    value: z.unknown(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('skill_invoke'),
    skillId: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('step_boundary'),
    step: z.number(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
  }),
]);

export type TraceEvent = z.infer<typeof TraceEventSchema>;

export const TraceSchema = z.object({
  trialId: TrialIdSchema,
  events: z.array(TraceEventSchema),
  finalAnswer: z.string().optional(),
  memorySnapshot: z.unknown().optional(),
});

export type Trace = z.infer<typeof TraceSchema>;
EOF

cat > packages/domain/src/index.ts <<'EOF'
export {
  ConfigIdSchema,
  ConfigSchema,
  ExperimentIdSchema,
  ExperimentSchema,
  GradeResultSchema,
  GraderSpecSchema,
  StateCheckSchema,
  TaskIdSchema,
  TaskSchema,
  TaskSetupSchema,
  TraceEventSchema,
  TraceSchema,
  TrialIdSchema,
  TrialSchema,
} from './schemas';

export type {
  Config,
  ConfigId,
  Experiment,
  ExperimentId,
  GradeResult,
  GraderSpec,
  StateCheck,
  Task,
  TaskId,
  TaskSetup,
  Trace,
  TraceEvent,
  Trial,
  TrialId,
} from './schemas';
EOF
```

`packages/domain/src/__tests__/fixtures/task.valid.json`:

```json
{
  "id": "det_add_01",
  "version": "1.0.0",
  "name": "Simple addition",
  "description": "Exact numeric answer",
  "prompt": "What is 17 + 25? Reply with only the number.",
  "graders": [
    {
      "type": "exact_match",
      "field": "final_answer",
      "expected": "42",
      "normalize": "trim_lower"
    }
  ],
  "tags": ["deterministic", "exact_match"]
}
```

`packages/domain/src/__tests__/fixtures/task.broken.json`:

```json
{
  "id": "det_add_01",
  "version": "1.0.0",
  "name": "Simple addition",
  "description": "Exact numeric answer",
  "prompt": "What is 17 + 25? Reply with only the number.",
  "graders": [
    {
      "type": "exact_match",
      "expected": 42
    }
  ],
  "tags": "deterministic"
}
```

```bash
cat > packages/domain/src/__tests__/task-schema.spec.ts <<'EOF'
import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import { TaskSchema } from '../schemas';

function readFixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

describe('TaskSchema', () => {
  it('accepts a real task JSON', () => {
    const task = TaskSchema.parse(readFixture('task.valid.json'));

    expect(task).toMatchObject({
      id: 'det_add_01',
      version: '1.0.0',
      name: 'Simple addition',
      tags: ['deterministic', 'exact_match'],
      graders: [
        {
          type: 'exact_match',
          field: 'final_answer',
          expected: '42',
          normalize: 'trim_lower',
        },
      ],
    });
  });

  it('rejects a broken task JSON', () => {
    expect(() => TaskSchema.parse(readFixture('task.broken.json'))).toThrow(
      ZodError,
    );
  });
});
EOF
```

### 2.2 Install and check

The first `npm install zod -w @agent-evals/domain` ran before npm saw the new workspace and did not record the dependency. After `package.json` was on disk:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
npm install -D vitest typescript tsx @types/node -w @agent-evals/domain
npm install zod -w @agent-evals/domain
npm test -w @agent-evals/domain
npx tsc -p packages/domain --noEmit
```

`npm test -w @agent-evals/domain` result: 1 file, 2 tests passed.

### Checkpoint 2

`TaskSchema.parse` accepts `task.valid.json` and rejects `task.broken.json`.

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
git add packages/domain package-lock.json
git commit -m "$(cat <<'EOF'
feat(domain): add Zod domain schemas

Define Task, Config, Experiment, Trial, GradeResult, TraceEvent, and Trace schemas in @agent-evals/domain, with tests for task parsing.

EOF
)"
```

---

## Phase 3 — Run the first real task (no API key)

**Goal:** One trial end-to-end: task file → baseline harness → mock model → `exact_match` grader → `trace.json` and `result.json`.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 3.0 Packages added in this phase

| Package / file | Purpose |
|---|---|
| `packages/trace` | `createTraceBuffer()`, `serializeTrace`, `deserializeTrace` |
| `packages/graders` | `exactMatch(finalAnswer, expected, normalize)` |
| `packages/adapters-model` | `ModelAdapter` types (§6.1) and `MockModelAdapter` (always replies `"42"` by default) |
| `packages/adapters-harness` | `HarnessAdapter` types (§6.2) and `BaselineHarness` (one user message, one model call, one assistant message) |
| `tasks/deterministic/01_add.json` | First real task: `What is 17 + 25?`, expected `42` |
| `scripts/run-one-trial.ts` | Runs one trial and grades it. Exit 0 on PASS, 1 on FAIL |

Each package has its own `package.json` with `"main": "src/index.ts"` and a `test` script (`vitest run`).

### 3.1 Install workspace links

New packages must be linked into `node_modules` before anything imports them:

```bash
npm install
```

Expect `node_modules/@agent-evals/` to contain `domain`, `trace`, `graders`, `adapters-model`, and `adapters-harness` as symlinks.

No API keys are needed. The mock model makes no network calls.

### 3.2 Run the unit tests

```bash
npm test -w @agent-evals/domain -w @agent-evals/trace -w @agent-evals/graders -w @agent-evals/adapters-model -w @agent-evals/adapters-harness
```

Expected: every package reports `Test Files 1 passed` (or more) and no failures.

Optional typecheck per package:

```bash
for p in domain trace graders adapters-model adapters-harness; do
  npx tsc -p packages/$p --noEmit && echo "tsc ok: $p"
done
```

### 3.3 Run the first real task (expect PASS)

```bash
npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json
echo "exit=$?"
```

Expected output (IDs and timestamps will differ):

```
PASS
  exact_match: expected=42 got=42
trace:  /var/folders/.../T/agent-evals/trial-<uuid>/trace.json
result: /var/folders/.../T/agent-evals/trial-<uuid>/result.json
exit=0
```

The paths are under `os.tmpdir()`. On macOS that is `$TMPDIR` (`/var/folders/...`). Each run gets a fresh sandbox directory and a fresh `trial-<uuid>` output directory, so runs do not overwrite each other.

### 3.4 Inspect the trace

Open the most recent trial's trace:

```bash
TMPD="$(node -p 'require("os").tmpdir()')"
RUN_DIR="$(ls -td "$TMPD"/agent-evals/trial-*/ | head -1)"
cat "${RUN_DIR}trace.json"
cat "${RUN_DIR}result.json"
```

The trace should contain, in order:

1. `step_boundary` with `step: 1`
2. `message` with `role: "user"` and the task prompt
3. `message` with `role: "assistant"` and `content: "42"`

and `finalAnswer: "42"`.

### 3.5 Checkpoint: FAIL on a wrong expected answer

Make a copy of the task with expected `"43"` (this does not edit the committed task file):

```bash
sed 's/"expected": "42"/"expected": "43"/' tasks/deterministic/01_add.json > /tmp/add_43.json
npx tsx scripts/run-one-trial.ts /tmp/add_43.json
echo "exit=$?"
```

Expected output:

```
FAIL
  exact_match: expected=43 got=42
trace:  ...
result: ...
exit=1
```

**Checkpoint 3 passes when:** 3.3 prints `PASS` with exit 0, the trace in 3.4 has the three events, and 3.5 prints `FAIL` with exit 1.

### 3.6 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@agent-evals/...'` | Workspace symlinks missing | Run `npm install` from the repo root |
| `listen EPERM ... tsx-*.pipe` | `tsx` could not open its IPC socket (happened inside a sandboxed agent shell) | Run from a normal terminal |
| `grader "unit_test" is not implemented yet` | `run-one-trial.ts` only grades `exact_match` so far | Use an `exact_match` task, or add the grader in a later phase |
| Test imports fail after adding a package | `npm install` not rerun after adding `package.json` | Run `npm install` again |

### 3.7 What this phase does not do

- No real model call. `MockModelAdapter` always returns `"42"`, so this run checks the pipeline, not model quality.
- No tools and no sandbox isolation. Phase 4 adds both (see below).
- No database. Results are written to disk only. Phase 6 adds persistence.

---

## Phase 4 — Tools and sandbox isolation (no API key)

**Goal:** The agent can write and read files in its own sandbox. Trial A cannot see trial B's files. A `state_check` grader passes when the agent writes the right file.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 4.0 Packages and files added in this phase

| Package / file | Purpose |
|---|---|
| `packages/sandbox` | `createSandbox(trialId)` (fresh temp dir per trial), `materializeFiles`, `resolveInSandbox` (blocks absolute paths, `..` escapes, and symlinks), `SandboxPathError` |
| `packages/adapters-harness/src/tools.ts` | Tools `write_file`, `read_file`, `list_dir`. Failures return `{ ok: false, result: { error } }` and never throw |
| `packages/adapters-harness/src/baseline.ts` | Now a tool loop: model call, run tool calls, feed results back, repeat until the model answers or a budget is hit (`max_steps`, `max_tokens`, `timeout`, `error`) |
| `packages/graders/src/state-check.ts` | `stateCheck(sandboxDir, checks)`: `exists`, `equals` (whitespace-trimmed), `jsonPathEquals` |
| `packages/adapters-model/src/scripted.ts` | `ScriptedModelAdapter`: replays a fixed list of responses, including tool calls. Used by tests and demos |
| `tasks/deterministic/02_write_answer.json` | Task: write `answer.txt` containing `ok`. Graded by `state_check` |
| `fixtures/scripted/write_answer.json` | Scripted model replies for that task: one `write_file` call, then `done` |
| `scripts/demo-isolation.ts` | Isolation demo (Checkpoint 4) |
| `scripts/run-one-trial.ts` | Now creates a sandbox per trial, seeds setup files, grades `state_check`, cleans up the sandbox, and accepts `--script <responses.json>` |

### 4.1 Install and run the unit tests

```bash
npm install
npm test -w @agent-evals/domain -w @agent-evals/sandbox -w @agent-evals/trace -w @agent-evals/graders -w @agent-evals/adapters-model -w @agent-evals/adapters-harness
```

Expected: all six packages report `Test Files ... passed` with no failures. Per package the test counts are 2, 9, 4, 12, 4 and 16.

Optional typecheck:

```bash
for p in domain sandbox trace graders adapters-model adapters-harness; do
  npx tsc -p packages/$p --noEmit && echo "tsc ok: $p"
done
```

### 4.2 Checkpoint 4a: isolation demo (expect ISOLATION OK)

```bash
npx tsx scripts/demo-isolation.ts
echo "exit=$?"
```

Trial A writes `secret.txt`. Trial B then tries two reads: `secret.txt` by name, and a `../` path into A's sandbox. Both must fail. B's sandbox must not contain the file.

Expected output (paths will differ):

```
trial A sandbox: /var/folders/.../T/agent-evals-trial-a-XXXXXX
trial B sandbox: /var/folders/.../T/agent-evals-trial-b-XXXXXX

PASS  trial A wrote secret.txt (sanity)
PASS  trial B read_file("secret.txt") fails  ({"error":"not found: secret.txt"})
PASS  trial B read_file via ../ into trial A fails  ({"error":"path escapes sandbox: ../agent-evals-trial-a-XXXXXX/secret.txt"})
PASS  trial A secret does not appear in trial B output or trace
PASS  trial B's sandbox has no secret.txt

ISOLATION OK: trial B could not see trial A data.
exit=0
```

### 4.3 Checkpoint 4b: state check passes (expect PASS)

```bash
npx tsx scripts/run-one-trial.ts tasks/deterministic/02_write_answer.json --script fixtures/scripted/write_answer.json
echo "exit=$?"
```

Expected output:

```
PASS
  state_check: all 1 state check(s) passed
stopped: completed (steps=2)
trace:  .../trace.json
result: .../result.json
exit=0
```

### 4.4 Negative check: without the script the state check fails (expect FAIL)

The default mock model answers `42` and never writes a file.

```bash
npx tsx scripts/run-one-trial.ts tasks/deterministic/02_write_answer.json
echo "exit=$?"
```

Expected output:

```
FAIL
  state_check: answer.txt: expected exists=true, got false; answer.txt: file missing
stopped: completed (steps=1)
...
exit=1
```

### 4.5 Inspect the tool trace

Run 4.3 first, so it is the most recent trial. Then open its trace:

```bash
TMPD="$(node -p 'require("os").tmpdir()')"
RUN_DIR="$(ls -td "$TMPD"/agent-evals/trial-*/ | head -1)"
cat "${RUN_DIR}trace.json"
```

The events should appear in this order:

1. `step_boundary` with `step: 1`
2. `message` with `role: "user"` and the task prompt
3. `message` with `role: "assistant"` and empty content (this is the tool-call turn)
4. `tool_call` with `name: "write_file"`, `callId: "call_1"`
5. `tool_result` with `callId: "call_1"` and `ok: true`
6. `step_boundary` with `step: 2`
7. `message` with `role: "assistant"` and `content: "done"`

Sandbox directories are deleted after each trial. The trace and result files are kept.

### 4.6 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@agent-evals/sandbox'` | Workspace link missing | Run `npm install` from the repo root |
| `listen EPERM ... tsx-*.pipe` | `tsx` could not open its IPC socket (happens in some sandboxed shells) | Run from a normal terminal |
| `scripted model exhausted after N response(s)` | The harness made more model calls than the script has responses | Add responses to the script file, or check that the model is not looping |
| `state_check` reports `symlinks are not allowed` | A symlink exists in the sandbox | Expected. Tools never create symlinks, so this means something outside the harness made one |

### 4.7 What this phase does not do

- The Phase 4 steps use the scripted model only. Phase 5 adds a live model (see below).
- `list_dir` is covered by unit tests only. No task uses it yet.
- The sandbox is a temp directory on the host, not a container. It keeps trials from seeing each other's files, but it does not contain a malicious tool or a shell. Phase 4 has no shell tool.
- The Phase 4 steps do not use `--model` or `--harness`. Phase 5 adds them.

---

## Phase 5 — Real model via OpenRouter

**Goal:** Replace the mock with a live model. Run the same addition task and the write-file task against it, and see what a live model does that the mock cannot show.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 5.0 Packages and files added in this phase

| Package / file | Purpose |
|---|---|
| `packages/adapters-model/src/openrouter.ts` | `OpenRouterAdapter`: OpenAI SDK pointed at `https://openrouter.ai/api/v1`. Maps messages and tools to the wire format, parses tool calls and token usage. Invalid tool-argument JSON stays visible in the trace (`__invalid_json`) |
| `packages/adapters-model/src/registry.ts` | `parseModelSpec("provider:modelId")` and `createModelAdapter(provider)`. Providers: `openrouter`, `mock` |
| `packages/adapters-harness/src/registry.ts` | `createHarness(id)`. Only `baseline` for now |
| `scripts/lib/env.ts` | Loads `.env` into `process.env`. Existing shell variables win |
| `scripts/smoke-model.ts` | One live call (Checkpoint 5a) |
| `scripts/run-one-trial.ts` | Adds `--model <provider:modelId>` and `--harness <id>`. Records `harness` and `model` in `result.json`. Prints usage and latency |

`--model` and `--script` cannot be used together. Without either flag the runner uses the mock model, as in Phases 3 and 4.

### 5.1 Set the API key

The key lives in `.env`, which is gitignored. `.env.example` has the variable name with an empty value:

```bash
# .env (not committed)
OPENROUTER_API_KEY=sk-or-...
```

Do not paste the key into any tracked file or into a command you save to the repo.

### 5.2 Install

```bash
npm install
```

This adds the `openai` SDK (`^7.62.0`) to `@agent-evals/adapters-model`.

### 5.3 Offline tests (no key needed)

```bash
npm test -w @agent-evals/adapters-model -w @agent-evals/adapters-harness
```

The OpenRouter tests use a fake `fetch`, so they never call the network. Expected: both packages pass.

### 5.4 Checkpoint 5a: smoke call (expect a reply and usage)

```bash
npx tsx scripts/smoke-model.ts
echo "exit=$?"
```

Pass a model id as the first argument to try another model, for example `npx tsx scripts/smoke-model.ts openai/gpt-4.1-mini`.

Expected output (the reply text may vary):

```
model:   openai/gpt-4.1-mini
reply:   The capital of France is Paris.
usage:   prompt=19 completion=8 total=27
latency: 1804 ms
exit=0
```

If `OPENROUTER_API_KEY` is missing, the script prints `OPENROUTER_API_KEY is not set. Add it to .env` and exits with code 2.

### 5.5 Checkpoint 5b: the addition task, three times (expect PASS each run)

```bash
for i in 1 2 3; do
  npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json \
    --model openrouter:openai/gpt-4.1-mini --harness baseline
  echo "exit=$?"
done
```

Expected output for each run (latency and IDs will differ):

```
PASS
  exact_match: expected=42 got=42
model:   openrouter:openai/gpt-4.1-mini
harness: baseline
stopped: completed (steps=1)
usage:   prompt=148 completion=3 total=151
latency: 1160 ms
trace:   .../trace.json
result:  .../result.json
exit=0
```

The token counts above come from a real run. Your numbers may differ slightly.

### 5.6 The write-file task on the live model

Task 02 needs the model to call `write_file`. This shows that tool calls work against a real model:

```bash
npx tsx scripts/run-one-trial.ts tasks/deterministic/02_write_answer.json \
  --model openrouter:openai/gpt-4.1-mini --harness baseline
echo "exit=$?"
```

Expected: `PASS`, `state_check: all 1 state check(s) passed`, `stopped: completed (steps=2)`, exit 0.

### 5.7 Inspect the live trial

Run 5.6 first, so it is the most recent trial. Then open its trace and result:

```bash
TMPD="$(node -p 'require("os").tmpdir()')"
RUN_DIR="$(ls -td "$TMPD"/agent-evals/trial-*/ | head -1)"
cat "${RUN_DIR}trace.json"
cat "${RUN_DIR}result.json"
```

The `result.json` should show `"harness": "baseline"` and `"model": { "provider": "openrouter", "modelId": "openai/gpt-4.1-mini" }`. The trace should contain a `tool_call` for `write_file` and a `tool_result` with `ok: true`.

### 5.8 Checkpoint 5 passes when

- 5a prints a reply with non-zero token usage.
- 5b prints `PASS` with exit 0 for each run, and usage is logged.
- 5.6 prints `PASS` (the model called the tool and wrote the file).

### 5.9 What you should observe, and what it does not show yet

In the example runs, the three `01_add` trials all passed with identical token counts. Temperature 0 does not guarantee identical outputs, and provider behavior can drift. Three passes on an easy task do not show variance, though. The non-determinism lesson needs many trials, or harder tasks, which come in Phase 8 and Phase 9. Do not treat three PASS results as proof that the model is reliable.

### 5.10 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `OPENROUTER_API_KEY is not set (add it to .env)` | Key missing or empty in `.env` | Add the key to `.env` and rerun |
| HTTP 401 from OpenRouter | Key is wrong or revoked | Check the key in the OpenRouter dashboard |
| HTTP 404 or "model not found" | Model id is misspelled | Use the exact id, e.g. `openai/gpt-4.1-mini` |
| `use either --model or --script, not both` | Both flags passed | Keep one |
| `unknown model provider "..."` | Provider name is not `openrouter` or `mock` | Use `openrouter:<modelId>` |
| `Cannot find module 'openai'` | `npm install` not run after the Phase 5 change | Run `npm install` |
| Network or DNS errors in an agent-run shell | The sandbox blocks outbound calls | Run from a normal terminal |

### 5.11 What this phase does not do

- No cost calculation. Only tokens and latency are logged, so `estimatedCostUsd` in the metrics stays unset.
- No N-trial runner. Each `run-one-trial.ts` call is one trial. Phase 6 stores experiments and queues their trials in the API. Phase 7 runs them.
- Only the baseline harness exists. Hermes comes in Phase 12.
- The SDK retries network errors, 429s, and 5xx responses up to 2 times. Other failures surface as `stoppedReason: "error"` only if they happen during the model call.

---

## Phase 6 — Persist with Postgres and NestJS modules

**Goal:** Tasks, configs, experiments, and trials live in Postgres behind the API. Config content hashes are stable, so a changed setting means a new version.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 6.0 Packages and files added in this phase

| Package / file | Purpose |
|---|---|
| `apps/api` deps: `@nestjs/typeorm`, `typeorm`, `pg` | Database access. Installed with `npm install @nestjs/typeorm typeorm pg -w @agent-evals/api` |
| `apps/api/src/load-env.ts` | Loads the repo-root `.env` before `AppModule` reads `process.env`. Shell variables win |
| `apps/api/src/app.module.ts` | TypeORM `forRootAsync` (reads `DATABASE_URL`, `synchronize` on for local dev) and the four feature modules |
| `apps/api/src/entities/` | `tasks`, `configs`, `experiments`, `trials` tables. Each keeps queryable columns plus a `jsonb` copy of the domain object |
| `apps/api/src/common/canonical-json.ts` | Sorted-key JSON and SHA-256 `contentHash` |
| `apps/api/src/common/zod-validation.pipe.ts` | Validates request bodies with the domain zod schemas. Invalid input gets HTTP 400 with the zod issues |
| `apps/api/src/tasks/` | `POST /tasks/import`, `GET /tasks`, `GET /tasks/:id` |
| `apps/api/src/configs/` | `POST /configs` (201 for a new version, 200 for an existing hash), `GET /configs`, `GET /configs/:id` |
| `apps/api/src/experiments/` | `POST /experiments` (pins task versions and config hashes), `POST /experiments/:id/start` (202, queues trials), `GET /experiments/:id`, `GET /experiments/:id/status` |
| `apps/api/src/trials/` | `GET /trials?experimentId=`, `GET /trials/:id`, `GET /trials/:id/trace` (404 until a trace is recorded) |
| `packages/domain/src/schemas.ts` | Adds `ConfigInputSchema`, `TaskImportSchema`, `ExperimentInputSchema` (request bodies without server-assigned fields) |
| `packages/domain` build (`tsconfig.build.json`, `dist/`) | The API imports the domain package at runtime, and Node cannot load `.ts` from a workspace. `main`/`exports` now point to `dist/` |
| `tasks/manifest.json` | Lists the task files to seed |
| `scripts/seed-tasks.ts` | Validates each task locally, then POSTs them to `/tasks/import`. Idempotent |
| `docker-compose.yml` | The `db` host port is `${POSTGRES_HOST_PORT:-5432}` (see 6.2) |

### 6.1 Prerequisites

- Docker Desktop running. Check with `docker info`.
- `jq` for the checkpoint output. On macOS: `brew install jq`.
- Port 5432 must be free for the default setup. Check with `lsof -nP -iTCP:5432 -sTCP:LISTEN`. If a local Postgres already owns it, see 6.2.

### 6.2 Start Postgres and Redis

```bash
docker compose up -d db redis
docker compose ps
```

Both services should show `Up`. Postgres accepts connections once it is ready:

```bash
docker compose exec -T db pg_isready -U evals -d evals
```

**If a local Postgres already listens on 5432,** `localhost:5432` resolves to that server, not to Docker. You will see `FATAL: role "evals" does not exist` from the API. Fix it by moving Docker to another host port. Add this to `.env` (untracked):

```bash
POSTGRES_HOST_PORT=5433
```

and change the port in `DATABASE_URL` to match:

```bash
DATABASE_URL=postgres://evals:evals@localhost:5433/evals
```

Then recreate the container. The data volume is kept:

```bash
docker compose up -d db
```

### 6.3 Install

```bash
npm install
```

Root `postinstall` builds `@agent-evals/domain` into `dist/`. The API's `prestart`, `prestart:dev`, and `prebuild` hooks rebuild it too.

If npm fails with `SELF_SIGNED_CERT_IN_CHAIN` (common behind a corporate proxy), use the system certificate store. Verification stays on:

```bash
NODE_OPTIONS=--use-system-ca npm install
```

### 6.4 Offline tests (no database needed)

```bash
npm test
```

Expected: all seven workspaces pass, including the API unit tests for canonical JSON, matrix expansion, and the validation pipe. The domain tests now include the new input schemas.

The API e2e test connects to the database, so run it with Postgres up:

```bash
npm run test:e2e -w @agent-evals/api
```

### 6.5 Start the API

Keep this running in its own terminal:

```bash
npm run start:dev -w @agent-evals/api
```

Expected in the log: the route list (`Mapped {/tasks/import, POST}` and so on), then `Nest application successfully started`. The `ObserveAgentWorker` line about placeholder keys is expected, because no Observe keys are set.

Tables are created on boot (`synchronize`, local dev only). Set `DB_SYNCHRONIZE=false` to turn this off once migrations exist.

### 6.6 Checkpoint 6a: tasks in the database

In a second terminal:

```bash
npm run seed:tasks
npm run seed:tasks
curl -s http://localhost:3000/tasks | jq 'length'
```

Expected:

```
created: 2, unchanged: 0
created: 0, unchanged: 2
2
```

The second seed run reports both tasks as unchanged, so seeding is safe to repeat.

### 6.7 Checkpoint 6b: config content hash is stable, and changing temperature makes a new hash

```bash
CFG='{
  "name": "baseline-gpt-mini",
  "harness": {
    "id": "baseline",
    "settings": {
      "skillsEnabled": [],
      "memory": { "enabled": false, "persistAcrossTrials": false },
      "tools": ["read_file", "write_file", "list_dir"],
      "maxSteps": 8,
      "maxTokens": 2048,
      "timeoutMs": 60000
    }
  },
  "model": { "provider": "openrouter", "modelId": "openai/gpt-4.1-mini", "temperature": 0.2 }
}'

# 1. First create: HTTP 201, version 1
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:3000/configs \
  -H 'content-type: application/json' -d "$CFG"

# 2. Same content again: HTTP 200, same id and hash (no new row)
curl -s -o /tmp/cfg-same.json -w "HTTP %{http_code}\n" -X POST http://localhost:3000/configs \
  -H 'content-type: application/json' -d "$CFG"
jq -c '{id, version, contentHash}' /tmp/cfg-same.json

# 3. Only temperature changes: HTTP 201, version 2, different hash
echo "$CFG" | jq -c '.model.temperature = 0.3' > /tmp/cfg-hot.json
curl -s -o /tmp/cfg-hot-resp.json -w "HTTP %{http_code}\n" -X POST http://localhost:3000/configs \
  -H 'content-type: application/json' -d @/tmp/cfg-hot.json
jq -c '{id, version, contentHash}' /tmp/cfg-hot-resp.json

curl -s http://localhost:3000/configs | jq -c '.[] | {name, version, temperature: .model.temperature, contentHash}'
```

Expected:

- Step 1 prints `HTTP 201` on a fresh database. If you ran this section before, it prints `HTTP 200`, which is also correct.
- Step 2 prints `HTTP 200` with the same `id` and `contentHash` as step 1.
- Step 3 prints `HTTP 201` with `version: 2` and a different `contentHash`.
- The final list shows two rows for `baseline-gpt-mini`, temperature `0.2` and `0.3`.

The hash is SHA-256 over the canonical JSON of `name`, `harness`, and `model`. Key order does not change it. Server-assigned fields (`id`, `version`, `contentHash`, `createdAt`) are ignored if a client sends them.

### 6.8 Create and start an experiment

This uses both task seeds and both config versions from 6.7 (2 tasks x 2 configs x 2 trials = 8 trials):

```bash
CFG_IDS=$(curl -s http://localhost:3000/configs | jq -c '[.[].id]')

EXP=$(curl -s -X POST http://localhost:3000/experiments \
  -H 'content-type: application/json' \
  -d "{\"name\":\"temp-sweep\",\"hypothesis\":\"temperature 0.2 vs 0.3\",\"taskIds\":[\"det_add_01\",\"det_write_answer_01\"],\"configIds\":$CFG_IDS,\"nTrials\":2}")
echo "$EXP" | jq -c '{id, status}'
EID=$(echo "$EXP" | jq -r .id)

curl -s -o /tmp/start.json -w "HTTP %{http_code}\n" -X POST http://localhost:3000/experiments/$EID/start
jq -c '{status, queued}' /tmp/start.json

curl -s -o /dev/null -w "second start: HTTP %{http_code}\n" -X POST http://localhost:3000/experiments/$EID/start
curl -s http://localhost:3000/experiments/$EID/status | jq -c .
curl -s "http://localhost:3000/trials?experimentId=$EID" | jq -c 'length'
```

Expected:

- Create returns `status: "pending"`.
- Start returns `HTTP 202`, `queued: 8`, and experiment `status: "running"`.
- A second start returns `HTTP 409`, so trials are never queued twice.
- The status shows `trials.total: 8` and `queued: 8`.
- The trials list has length 8.

Each trial pins the task version and config `contentHash` it was created with, and gets a deterministic `seed`. At the moment of start the trials are `queued`. Phase 7 added the worker that runs them (see Phase 7). Right after start, the trace endpoint returns 404 until that trial finishes:

```bash
TID=$(curl -s "http://localhost:3000/trials?experimentId=$EID" | jq -r '.[0].id')
curl -s -o /dev/null -w "trace: HTTP %{http_code}\n" http://localhost:3000/trials/$TID/trace
```

Expected right after start: `trace: HTTP 404`. Once the trial finishes, the same request returns `200`.

### 6.9 Checks for the error paths (optional)

| Request | Expected |
|---|---|
| `POST /experiments` with `"taskIds": ["nope"]` | 400, `missingTaskIds: ["nope"]` |
| `POST /experiments` with `"nTrials": 0` | 400 validation error |
| `POST /tasks/import` with a changed prompt for an existing `id@version` | 409, "bump the version instead" |
| `GET /experiments/not-a-uuid` | 400 |
| `GET /experiments/00000000-0000-4000-8000-000000000000` | 404 |

### 6.10 Checkpoint 6 passes when

- `GET /tasks` returns 2 tasks, and re-seeding reports them as unchanged.
- The config create returns 201, then 200 for identical content, then 201 with a new version and hash when temperature changes.
- An experiment starts once (202), a second start is rejected (409), and 8 trials are queued.

### 6.11 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FATAL: role "evals" does not exist` in the API log | A local Postgres owns port 5432 | Use `POSTGRES_HOST_PORT=5433` (see 6.2) |
| `ECONNREFUSED 127.0.0.1:5432` | The DB container is not running | `docker compose up -d db` |
| `SELF_SIGNED_CERT_IN_CHAIN` during `npm install` | Corporate TLS interception | `NODE_OPTIONS=--use-system-ca npm install` |
| `Cannot find module '@agent-evals/domain'` or a missing `dist` | Domain not built | `npm run build -w @agent-evals/domain` |
| `DATABASE_URL is not set` | `.env` missing the variable | Add it to `.env` (see Phase 1.5) |
| `seed-tasks: fetch failed` | API not running | Start it with `npm run start:dev -w @agent-evals/api` |
| 409 on import | A task `id@version` exists with different content | Bump `version` in the task JSON |

### 6.12 What this phase does not do

- Trials are queued, not run, in this phase. Phase 7 adds the worker that runs them. An experiment shows `running` while its trials are `queued`.
- No migrations yet. `synchronize` creates the tables for local development only.
- No authentication, pagination, or Redis use yet.
- The seed script needs the API running. It does not write to the database directly.
- `npm audit` reports 8 advisories from the new dependency tree. Not addressed in this phase.

---

## Phase 7 — Job queue: N trials for real

**Goal:** One experiment expands into many isolated jobs. A failed or timed-out trial does not corrupt the others.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 7.0 Packages and files added in this phase

| Package / file | Purpose |
|---|---|
| `packages/runner` (`@agent-evals/runner`) | `runTrial()`: the trial pipeline moved out of the CLI. Fresh sandbox, harness under a wall-clock timeout, graders, cleanup. Returns `succeeded`, `failed`, or `timeout`. Used by the CLI and the worker |
| `scripts/run-one-trial.ts` | Now calls `runTrial()`. Same arguments and output, plus a status line. Exit codes: 0 pass, 1 fail or timeout, 2 infrastructure error |
| `apps/api/src/queue/trial-queue.ts` | BullMQ queue `trials`. Each trial is one job, with `jobId` = trial id. 3 attempts, exponential backoff from 2 s |
| `apps/api/src/execution/trial-executor.service.ts` | Job handler. Idempotent: skips terminal trials. Claims the trial, runs it, retries retryable failures, writes the trace file, then finalizes the trial and rolls up the experiment status in one transaction |
| `apps/api/src/execution/trial.processor.ts` | BullMQ consumer. Concurrency from `TRIAL_CONCURRENCY` (default 2) |
| `apps/api/src/execution/execution.module.ts` | Wires the executor and the consumer. Set `TRIAL_WORKER=off` to run the API without the consumer |
| `apps/api/src/experiments/experiment-status.ts` | Trial counts and the experiment status rules (spec included) |
| `apps/api/src/common/trace-store.ts` | Writes trace files to `data/traces/<experimentId>/<trialId>.json`. `TRACE_DIR` overrides the root. The database keeps only `traceUri` |
| `apps/api/src/common/redis.ts` | Parses `REDIS_URL` into BullMQ connection options (spec included) |
| `packages/trace`, `sandbox`, `graders`, `adapters-model`, `adapters-harness`, `runner` | Build to `dist/` like `domain`. Their imports now use `.js` specifiers, so Node can load them |
| root `build:packages` script | Builds the runtime packages in dependency order. `postinstall` and the API's `prestart` / `prebuild` run it |
| `apps/api` deps: `@nestjs/bullmq`, `bullmq`, `ioredis` | Job queue. `ioredis` is required by BullMQ as an optional peer |
| `.gitignore` | Adds `data/` (trace files) |

Removed: the inline `trace` column on `trials`. Traces are files now. Development `synchronize` drops that column on the next boot.

### 7.1 Install and build

```bash
npm install
```

If npm reports `SELF_SIGNED_CERT_IN_CHAIN`, use `NODE_OPTIONS=--use-system-ca npm install` (see Phase 6).

`postinstall` runs `npm run build:packages`. After you edit any file under `packages/`, rebuild before running the API or another package's tests, because they import `dist/`:

```bash
npm run build:packages
```

### 7.2 Offline tests (no key, no network)

```bash
npm test
```

Expected: ten workspaces pass (`stats` was added in Phase 10, `web` in Phase 11). The totals are `api` 50, `adapters-harness` 52, `adapters-model` 19, `domain` 8, `graders` 36, `runner` 11, `sandbox` 9, `stats` 31, `trace` 4, `web` 29 (these counts are current as of Phase 13; Phase 13 raised `api` from 35 to 50 with the export tests). The Python worker has its own suite: 35 tests, see Phase 12. The runner tests cover pass, scored fail, model error (retryable), wall-clock timeout, unsupported grader, and a `unit_test` grader running against the agent's file.

The API e2e test needs Postgres and Redis running:

```bash
npm run test:e2e -w @agent-evals/api
```

### 7.3 Checkpoint 7-0: the CLI still runs offline (expect PASS, then FAIL)

```bash
npx tsx scripts/run-one-trial.ts tasks/deterministic/02_write_answer.json --script fixtures/scripted/write_answer.json
echo "exit=$?"

npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json --script fixtures/scripted/write_answer.json
echo "exit=$?"
```

The first run prints `PASS` and exits 0. The second prints `FAIL` with `expected=42 got=done` and exits 1.

### 7.4 Start the stack

```bash
docker compose up -d db redis
npm run start:dev -w @agent-evals/api
```

Keep the API running in its own terminal. The worker runs inside the API process, so worker errors appear in that terminal's log.

Options:

| Variable | Default | Meaning |
|---|---|---|
| `TRIAL_CONCURRENCY` | `2` | Trials that run at the same time |
| `TRIAL_WORKER` | on | Set to `off` to run the API without consuming the queue |
| `TRACE_DIR` | `data/traces` | Where trace files go |

Phase 6 must already be done: the tasks are seeded and at least one config exists. In another terminal, look up the config from Phase 6 (`baseline-gpt-mini`, version 1, temperature 0.2):

```bash
A=http://localhost:3000
npm run seed:tasks
C1=$(curl -s $A/configs | jq -r '[.[] | select(.name=="baseline-gpt-mini" and .version==1)][0].id')
echo "config: $C1"
```

If that prints `config: null`, run the Phase 6 config steps first.

### 7.5 Checkpoint 7a: five trials through the queue (expect 5 succeeded)

```bash
EXP=$(curl -s -X POST $A/experiments -H 'content-type: application/json' \
  -d "{\"name\":\"smoke-n5\",\"hypothesis\":\"Platform can run repeated trials\",\"taskIds\":[\"det_add_01\"],\"configIds\":[\"$C1\"],\"nTrials\":5}")
EID=$(echo "$EXP" | jq -r .id)

curl -s -o /dev/null -w "start: HTTP %{http_code}\n" -X POST $A/experiments/$EID/start

# poll until the experiment leaves "running"
until [ "$(curl -s $A/experiments/$EID/status | jq -r .status)" != "running" ]; do sleep 2; done
curl -s $A/experiments/$EID/status | jq .
curl -s "$A/trials?experimentId=$EID" | jq -c '.[] | {trialIndex, status, passed, seed, hasTrace}'
```

Expected:

- `start: HTTP 202`
- The status is `completed`, with `"succeeded": 5` and no queued or running trials.
- Each of the five trials has `"status": "succeeded"`, `"passed": true`, and `"hasTrace": true`.
- Each trial has a different `seed`.

Check that each trace file exists:

```bash
ls data/traces/$EID/
```

Expected: five `.json` files named by trial id.

### 7.6 Checkpoint 7b: a timeout does not delete the other trials (expect partial)

Create a config whose wall-clock budget is 1 ms. Every trial with it must time out. The config is immutable, so this is a new config, not an edit:

```bash
PROBE=$(curl -s -X POST $A/configs -H 'content-type: application/json' -d '{
  "name": "timeout-probe",
  "harness": { "id": "baseline", "settings": {
    "skillsEnabled": [], "memory": { "enabled": false, "persistAcrossTrials": false },
    "tools": ["read_file", "write_file", "list_dir"], "maxSteps": 8, "maxTokens": 2048, "timeoutMs": 1 } },
  "model": { "provider": "openrouter", "modelId": "openai/gpt-4.1-mini", "temperature": 0.2 }
}' | jq -r .id)

EXP=$(curl -s -X POST $A/experiments -H 'content-type: application/json' \
  -d "{\"name\":\"timeout-mix\",\"hypothesis\":\"timeouts do not delete other trials\",\"taskIds\":[\"det_add_01\",\"det_write_answer_01\"],\"configIds\":[\"$C1\",\"$PROBE\"],\"nTrials\":2}")
EID=$(echo "$EXP" | jq -r .id)
curl -s -o /dev/null -w "start: HTTP %{http_code}\n" -X POST $A/experiments/$EID/start
until [ "$(curl -s $A/experiments/$EID/status | jq -r .status)" != "running" ]; do sleep 2; done
curl -s $A/experiments/$EID/status | jq -c '{status, trials}'
curl -s "$A/trials?experimentId=$EID" | jq -c '.[] | {taskId, status, passed, error: .error.code}'
```

Expected:

- The experiment status is `partial`.
- Trials: `"succeeded": 4`, `"timeout": 4`, and 8 rows in total.
- The four probe trials show `"status": "timeout"`, `"error": "timeout"`, and `"passed": false`.
- The four `$C1` trials show `"succeeded"` and `"passed": true`. This includes `det_write_answer_01`, which calls `write_file` on the live model.
- Every row has a trace. A timed-out trial's trace holds the events recorded before the cut-off.

### 7.7 Checkpoint 7c: an infrastructure failure is retried, then recorded as failed

Use a model ID that does not exist. OpenRouter rejects it, the harness stops with `error`, and the executor records a retryable `model_error`. BullMQ retries it until the attempts run out:

```bash
BAD=$(curl -s -X POST $A/configs -H 'content-type: application/json' -d '{
  "name": "bad-model",
  "harness": { "id": "baseline", "settings": {
    "skillsEnabled": [], "memory": { "enabled": false, "persistAcrossTrials": false },
    "tools": ["read_file", "write_file", "list_dir"], "maxSteps": 8, "maxTokens": 2048, "timeoutMs": 60000 } },
  "model": { "provider": "openrouter", "modelId": "openai/no-such-model-xyz", "temperature": 0 }
}' | jq -r .id)

EXP=$(curl -s -X POST $A/experiments -H 'content-type: application/json' \
  -d "{\"name\":\"bad-model-retry\",\"hypothesis\":\"infra failures are retried then recorded\",\"taskIds\":[\"det_add_01\"],\"configIds\":[\"$BAD\"],\"nTrials\":1}")
EID=$(echo "$EXP" | jq -r .id)
curl -s -o /dev/null -X POST $A/experiments/$EID/start
until [ "$(curl -s $A/experiments/$EID/status | jq -r .status)" != "running" ]; do sleep 2; done
curl -s $A/experiments/$EID/status | jq -c '{status, trials}'
TID=$(curl -s "$A/trials?experimentId=$EID" | jq -r '.[0].id')
curl -s $A/trials/$TID | jq -c '{status, error}'

# BullMQ attempt counter for the job (field "atm")
docker compose exec -T redis redis-cli HGET bull:trials:$TID atm
```

Expected:

- The experiment status is `failed`, because every trial had an infrastructure failure.
- The trial has `"status": "failed"` and `"error": {"code": "model_error", "retryable": true, ...}`.
- The Redis counter prints `3`. The job ran three attempts, with about 2 s and 4 s of backoff between them.

### 7.8 Infra failure versus scored failure

| Trial status | Meaning | `passed` | Counts toward experiment `partial`? |
|---|---|---|---|
| `succeeded` | The agent finished and graders ran | `true` or `false` | No. A wrong answer is a valid result |
| `failed` | Infrastructure problem: model error, sandbox error, unsupported grader, setup error (e.g. missing API key) | `false` | Yes. It also makes the experiment `failed` if every trial failed |
| `timeout` | The trial exceeded its wall-clock budget | `false` | Yes |

Experiment status:

- `running`: some trial is `queued` or `running`
- `completed`: every trial was scored, passing or failing
- `partial`: some trials failed, timed out, or were cancelled
- `failed`: every trial had an infrastructure failure

### 7.9 Inspect a trial

```bash
curl -s $A/trials/$TID/trace | jq '{trialId, finalAnswer, events: (.events | length)}'
```

The trace file is at `data/traces/<experimentId>/<trialId>.json`. The trace endpoint reads that file. It returns 404 when the trial has no trace yet, or when the file is missing.

### 7.10 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `BullMQ could not load the optional 'ioredis' package` at API start | `ioredis` not installed | `npm install ioredis@^5 -w @agent-evals/api` |
| Experiment stays `running` and nothing moves | No consumer: API stopped, `TRIAL_WORKER=off`, or Redis down | Start the API without `TRIAL_WORKER=off` and check Redis with `docker compose ps redis` |
| Trials end as `failed` with `setup_error` and no retries | Missing `OPENROUTER_API_KEY` or unknown provider. Setup errors are not retried | Add the key to `.env`, then create a new experiment |
| `Cannot find module '@agent-evals/runner'` or stale behavior | `dist/` not built, or built before your last edit | `npm run build:packages` |
| `POST /start` returns 500 and the experiment is `running` with `queued` trials | Redis was down when enqueueing. The rows were committed, the jobs were not | Restart Redis. There is no requeue endpoint yet, so create a new experiment |
| `POST /start` returns 409 | The experiment was already started | Create a new experiment |

### 7.11 What this phase does not do

- **Timeouts do not cancel the harness.** The runner records the trial as `timeout` and removes its sandbox. A model call already in flight keeps running until it returns. The baseline harness then stops at its next step check.
- **Every model error is retried, including bad model IDs.** The 400 "not a valid model ID" from 7.7 uses all three attempts. Classifying 4xx responses as non-retryable is a follow-up.
- **The worker is in-process.** The plan allowed a separate `workers/node-worker`. `TRIAL_WORKER=off` is the switch for that later.
- **No cancel endpoint, no requeue, no cost metering.** `estimatedCostUsd` stays unset.
- **Traces are local files**, not blob storage.
- **No statistics yet.** Phase 10 adds them.
- `npm audit` still reports the 8 advisories from Phase 6.

---

## Phase 8 — Author the full task set (≥20)

**Goal:** Meet the assignment's coverage (≥20 tasks, mixed graders, some that discriminate memory and skills) with tasks that can actually separate configs.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 8.0 What changed in this phase

| Area | Change |
|---|---|
| `tasks/` | 19 new task files (21 in total, listed in `tasks/manifest.json`). Folders: `deterministic/`, `judge/`, `discriminating/` |
| `packages/graders` | `unitTest()` grader: runs the task's command in the sandbox, exit 0 passes. Timeout and non-zero exit are scored failures. The child gets only `PATH` in its environment |
| `packages/adapters-harness` | `createTrialMemory()` (per-trial key-value store seeded from `setup.memory`), `csv_summary` skill, `memory_read` / `memory_write` tools, `resolveToolIds()`. The baseline loop emits `memory_read`, `memory_write` and `skill_invoke` trace events |
| `packages/domain` | `TaskSetup.memory` (optional map of facts that start in the trial's memory) |
| `packages/runner` | Runs `unit_test` graders. Passes `setup.memory` into the trial |
| `apps/api` | The executor computes tools with `resolveToolIds()`: config tools plus memory and skill tools, narrowed (never widened) by `toolsAllowed` |
| `scripts/validate-task-set.ts` | Checks the task set (see 8.2) |
| `scripts/run-one-trial.ts` | New flags `--memory` and `--skill <id>` |
| `fixtures/scripted/` | `memory_recall_client.json` and `skill_csv_sum.json`, for offline checks of the tool path |

Behavior change: the baseline loop now refuses any tool the trial was not offered, even if the model names it. Before this phase, a model could call a tool that the config had left out. The refusal comes back as a failed `tool_result` with `tool not available in this trial: <name>`.

### 8.1 Task inventory

| Batch | Folder | Tasks | Grader |
|---|---|---|---|
| A | `deterministic/` | `det_add_01` (Phase 3), `det_extract_order_01`, `det_letter_count_01`, `det_unit_convert_01`, `det_weekday_01` | `exact_match` (5) |
| B | `deterministic/` | `det_write_answer_01` (Phase 4), `det_state_json_01`, `det_state_nested_01`, `det_state_multi_01` | `state_check` (4) |
| C | `deterministic/` | `det_unit_fizzbuzz_01`, `det_unit_slugify_01`, `det_unit_roman_01` | `unit_test` (3) |
| D | `judge/` | `judge_summary_01`, `judge_explain_01`, `judge_email_01`, `judge_bugreport_01`, `judge_tradeoff_01` | `llm_judge` (5). Graded by the judge from Phase 9 (version 1.1.0, see §9.0) |
| E | `discriminating/` | `mem_recall_client_01`, `mem_deploy_file_01` | memory-discriminating (`exact_match`, `state_check`) |
| E | `discriminating/` | `skill_csv_sum_01`, `skill_csv_mean_01` | skill-discriminating (`exact_match`) |

Some tasks hold their own fixtures in `setup.files`. Both CSVs (150 orders and 120 requests) are in the task JSON. They were generated once with a seeded script, and the expected answers (`11846` and `228`) were computed from them. The validator does not re-derive the answers.

Two design notes:

- **Unit-test tasks** ship their test file in `setup.files`, and the agent writes `solution.js`. The grader runs `node test_*.js`, so the test decides the result and the answer text does not matter. A correct reference solution passes, and an empty one fails.
- **Discriminating tasks** keep the key fact out of the prompt and out of the sandbox. The memory tasks have no other route to the fact. The skill tasks can be attempted by hand, but the probe in 8.4 shows the model gets them wrong that way.

### 8.2 Build, seed, and validate

```bash
npm run build:packages
npm test
```

Expected: eight workspaces pass. The totals are listed in Phase 7 (§7.2).

Seed the tasks. The API must be running (`npm run start:dev -w @agent-evals/api`, as in §7.4):

```bash
npm run seed:tasks
```

Expected on a fresh database, where the 2 Phase 3 and 4 tasks already exist: `created: 19, unchanged: 2`. Re-running reports the same tasks as unchanged, so it is safe.

Validate the task set:

```bash
npx tsx scripts/validate-task-set.ts
```

Expected:

```
tasks: 21 (minimum 20)
graders: exact_match=8, state_check=5, unit_test=3, llm_judge=5
memory-tagged: 2, skill-tagged: 2
task set OK
```

The validator exits 1 and lists each problem when a rule fails. The rules: every manifest entry matches the domain schema, every `.json` under `tasks/` is listed in the manifest, ids are unique, there are at least 20 tasks, every grader type appears, there is at least one memory and one skill task, discriminating tasks name their discriminator in `expectedDiscriminators`, and `toolsAllowed` only names real tools.

Checkpoint 8:

```bash
curl -s http://localhost:3000/tasks | jq length
```

Expected: `21`.

### 8.3 How the discriminators are wired

Discriminators are switched by the config, not by the task. The task only says what it needs.

```json
{
  "name": "p8-memory",
  "harness": {
    "id": "baseline",
    "settings": {
      "skillsEnabled": [],
      "memory": { "enabled": true, "persistAcrossTrials": false },
      "tools": ["read_file", "write_file", "list_dir"],
      "maxSteps": 8, "maxTokens": 4096, "timeoutMs": 60000
    }
  },
  "model": { "provider": "openrouter", "modelId": "openai/gpt-4.1-mini", "temperature": 0 }
}
```

- **Memory:** `memory.enabled: true` adds `memory_read` and `memory_write`. Each trial's store starts with `task.setup.memory`. `mem_recall_client_01` holds `client_id = HL-2044` only in that store.
- **Skill:** `skillsEnabled: ["csv_summary"]` adds the `csv_summary` tool. It computes `sum`, `mean`, `min`, `max` or `count` over one column, with an optional list of `where` conditions that must all match. The model gets an exact result instead of doing arithmetic over 150 rows.
- **Narrowing:** a task's `toolsAllowed` can remove tools. It cannot add any.

A config's `persistAcrossTrials` is stored but not implemented. Every trial starts with an empty memory.

Offline, the same wiring works through the CLI:

```bash
npx tsx scripts/run-one-trial.ts tasks/discriminating/mem_recall_client_01.json --memory --script fixtures/scripted/memory_recall_client.json
npx tsx scripts/run-one-trial.ts tasks/discriminating/skill_csv_sum_01.json --skill csv_summary --script fixtures/scripted/skill_csv_sum.json
```

Both print `PASS`. Scripted replies always give the right answer, so the pass alone proves nothing. Check the trace instead: the run with `--memory` has a `memory_read` event with the hit, and the run without it has a `tool_result` with `ok: false`.

### 8.4 Live checks (what I ran)

**Smoke, every task once, base config (`p8-base`, no memory, no skill, `gpt-4.1-mini`, temperature 0):**

```bash
A=http://localhost:3000
BASE=$(curl -s $A/configs | jq -r '.[] | select(.name=="p8-base") | .id')
IDS=$(curl -s $A/tasks | jq -c '[.[].id]')
E=$(curl -s -X POST $A/experiments -H 'content-type: application/json' \
  -d "{\"name\":\"p8-full-smoke\",\"hypothesis\":\"every task runs once\",\"taskIds\":$IDS,\"configIds\":[\"$BASE\"],\"nTrials\":1}" | jq -r .id)
curl -s -o /dev/null -X POST $A/experiments/$E/start
until [ "$(curl -s $A/experiments/$E/status | jq -r .status)" != "running" ]; do sleep 3; done
curl -s $A/experiments/$E/status | jq -c '{status, trials}'
```

Result at Phase 8 (before the judge existed): experiment `partial`, with 16 succeeded and 5 failed. Phase 9 grades the 5 judge tasks; see §9.4.

| Group | Result |
|---|---|
| 12 deterministic tasks (exact, state, unit test) | all pass, including the 3 unit-test tasks run through the worker |
| 5 judge tasks | at Phase 8, all `failed` with `grader_not_implemented`. Not retried. Phase 9 adds the `llm_judge` grader |
| 4 discriminating tasks (`mem_*`, `skill_*`) | all fail without their tool, as intended |

`partial` was the correct reading at Phase 8. Five trials had an infrastructure failure (an unimplemented grader), so the experiment is partial, not completed. Scored failures alone would not do that.

**Discrimination probe, two trials per cell, temperature 0:**

| Task | Base config | With the tool | Tool calls per trial, tool on |
|---|---|---|---|
| `mem_recall_client_01` | 0/2 | 2/2 | `memory_read` ×2 |
| `mem_deploy_file_01` | 0/2 | 2/2 | `memory_read` ×4, `write_file` ×1 |
| `skill_csv_sum_01` | 0/2 | 2/2 | `csv_summary` ×1 |
| `skill_csv_mean_01` | 0/2 | 2/2 | `csv_summary` ×1 |

With the tool off, the base model answered `skill_*` by reading the whole CSV and got it wrong both times. For `mem_*` it never called a tool and answered without the fact.

This is a direction check, not a measurement. Two trials per cell at temperature 0 says nothing about effect size or noise. Phase 10 adds the statistics for that.

### 8.5 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Validator: `unknown tool "..."` | A `toolsAllowed` entry is misspelled | Use a name from `TOOL_SPECS` |
| Validator: `not listed in tasks/manifest.json` | A task file was added without a manifest entry | Add it to the manifest |
| `POST /tasks/import` returns 409 and the batch is rejected | A task's content changed under the same `version` | Bump `version` for the changed task. Trials pin versions, so edits under one version are refused |
| Trial fails with `setup_error` and an `unknown skill` message | A config lists a skill id that does not exist, e.g. `csv_sumary` | Fix the config's `skillsEnabled`. Configs are immutable, so create a new one |
| Trace shows `tool not available in this trial: memory_read` | The config has memory off but the task needs memory | Expected for the base config. Use a config with `memory.enabled: true` |
| `judge_*` trials fail with `grader_not_implemented` | The API is running code built before Phase 9 | Run `npm run build:packages`, then restart the API. Phase 9 implements `llm_judge` |
| `unit_test` grade reasoning says `timed out` | The agent's code loops, or the test is slow. This is a scored failure (`status: succeeded`, `passed: false`) | Read the trace. Raise `timeoutMs` only if the test is genuinely slow |

### 8.6 What this phase does not do

- **Memory is a seeded fact, not a turn-1 write.** The plan allowed this proxy when history cannot be stripped. The baseline harness takes one prompt per trial, so a fact that the agent saves with `memory_write` on turn 1 and must read back later has no place to run yet. The discrimination still holds (the fact is unreachable without memory), but it does not test writes across turns.
- **`persistAcrossTrials` is not implemented.** Every trial starts with an empty memory.
- **The CSV reader handles plain values only.** Quoted fields and embedded commas are not supported. The fixtures do not need them.
- **`skill_invoke` uses the tool name as the skill id** (`csv_summary` for both). That holds until a skill has more than one tool.
- **Unit-test commands run through `sh -c` with the sandbox as cwd.** Task authors are trusted. The child gets only `PATH`, so API keys are not visible to it, but nothing stops network access from the command.
- **The probe is small.** Two trials per cell at temperature 0. Treat the table as a direction check.

## Phase 9 — LLM judge + human agreement

**Goal:** Model-based grading you can defend. A judge score counts only after its agreement with human labels is measured.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 9.0 What changed in this phase

| Area | Change |
|---|---|
| `packages/adapters-model` | `ModelRequest.responseFormat: 'json'` sends `response_format: { type: "json_object" }` to OpenRouter. Tests in `openrouter-json.spec.ts` |
| `packages/graders/src/rubrics.ts` | Five rubrics (`summary_v1`, `explanation_v1`, `email_v1`, `bugreport_v1`, `tradeoff_v1`). Each criterion has a weight and a `required` flag |
| `packages/graders/src/llm-judge.ts` | `buildJudgePrompt`, `parseJudgeOutput` (strips ```` ```json ```` fences), `scoreRubric`, and `llmJudge()`. The judge is called at temperature 0 with JSON output. A malformed reply gets one retry, which shows the judge its bad reply. A second malformed reply throws `JudgeOutputError` |
| `packages/runner` | The `llm_judge` branch. An unknown rubric id is a non-retryable `rubric_not_found`. Malformed judge output is a non-retryable `judge_invalid_output`. A judge model error is an infrastructure error, as for the agent |
| `tasks/judge/*.json` | Version `1.1.0`, `judgeModel: "google/gemini-2.5-flash"`, `passThreshold: 0.7`. Version 1.0.0 named a judge model that OpenRouter no longer served (404), and content cannot change under the same version, so the tasks were bumped |
| `fixtures/judge-human-labels/` | 25 labels, `lbl_01.json` to `lbl_25.json`, five per judge task. Format: `{id, taskId, answer, humanPassed, notes}`. 9 pass, 16 fail. Borderline fails are included on purpose |
| `scripts/validate-judge.ts` | Runs the judge on every label and prints agreement, Cohen's κ, the confusion matrix, per-task numbers and disagreements. Exits 0 only when κ ≥ 0.6 and no label failed to judge |
| `scripts/validate-task-set.ts` | Checks that each `llm_judge` rubric id exists |

### 9.1 Install and build

```bash
npm run build:packages
npm test
```

Expected totals as of Phase 9: `api` 30, `adapters-harness` 43, `adapters-model` 19, `domain` 8, `graders` 36, `runner` 11, `sandbox` 9, `trace` 4. Phase 10 raises `api` to 35 and adds `stats`; §7.2 has the current totals. The new `graders` tests cover the scoring rule, the prompt, the parsing (fenced JSON, missing criteria, out-of-range scores), the retry after a malformed reply, and the error when both replies are malformed. The `runner` tests cover the rubric-not-found and invalid-output paths.

### 9.2 How the judge scores

Each rubric criterion is scored by the judge from 0.0 to 1.0. A criterion is **met** at score ≥ 0.5. The verdict is:

- `overall` = the weighted mean of the scores
- `passed` = every `required` criterion is met **and** `overall` ≥ the task's `passThreshold` (0.7)

The `required` flag exists because a plain weighted mean would let a missing must-have pass when the other criteria carry enough weight. For example, a summary that omits the outage cause would still score about 0.75 on four equal criteria.

| Rubric | Criteria (weight, `required`) |
|---|---|
| `summary_v1` | `outage_cause`, `affected_region`, `fix_date`, `two_sentences` (all 1, required) |
| `explanation_v1` | `scientific_correctness` (2, required), `child_friendly_language`, `under_80_words`, `no_equations` (all 1, required) |
| `email_v1` | `polite_decline` (2, required), `one_sentence_reason` (1, required), `specific_alternative` (2, required), `signed_sam` (1, required), `tone_clarity` (1, optional) |
| `bugreport_v1` | `numbered_steps` (2, required), `expected_behavior`, `actual_behavior`, `environment`, `no_invented_details` (all 1, required) |
| `tradeoff_v1` | `three_bullets` (1, required), `benefit_and_cost` (2, required), `service_recommendation` (1, required), `accuracy` (2, optional) |

Bias controls: the judge (`google/gemini-2.5-flash`) is a different model family from the agent (`openai/gpt-4.1-mini`). It runs at temperature 0 with JSON output, and it sees the rubric and the criteria, not a preferred answer. This reduces bias. It does not remove it, and the agreement numbers in 9.5 are the evidence.

### 9.3 Checkpoint 9a: judge reasoning visible in a trial (expect 5 succeeded)

The API must be running, with the Phase 7 stack up (`docker compose up -d db redis`, then `npm run start:dev -w @agent-evals/api`):

```bash
A=http://localhost:3000
npm run seed:tasks
```

The first seed after this phase on a database that has the Phase 8 tasks reports `created: 5, unchanged: 16`. Those five rows are the judge tasks at 1.1.0. Re-running reports `unchanged: 21`. Experiments pin the latest version when they are created, so new runs use 1.1.0.

Create a config for the judge run. It is the base config with no memory and no skills. Configs are keyed by content hash, so posting the same body again is safe:

```bash
JUDGE_CFG=$(curl -s -X POST $A/configs -H 'content-type: application/json' -d '{
  "name": "p9-judge-base",
  "harness": { "id": "baseline", "settings": {
    "skillsEnabled": [], "memory": { "enabled": false, "persistAcrossTrials": false },
    "tools": ["read_file", "write_file", "list_dir"], "maxSteps": 8, "maxTokens": 4096, "timeoutMs": 60000 } },
  "model": { "provider": "openrouter", "modelId": "openai/gpt-4.1-mini", "temperature": 0 }
}' | jq -r .id)
echo "config: $JUDGE_CFG"
```

Create the experiment, start it, and wait for it to finish:

```bash
EXP=$(curl -s -X POST $A/experiments -H 'content-type: application/json' \
  -d "{\"name\":\"p9-judge-checkpoint\",\"hypothesis\":\"judge returns reasoning in a trial\",\"taskIds\":[\"judge_summary_01\",\"judge_explain_01\",\"judge_email_01\",\"judge_bugreport_01\",\"judge_tradeoff_01\"],\"configIds\":[\"$JUDGE_CFG\"],\"nTrials\":1}")
EID=$(echo "$EXP" | jq -r .id)
curl -s -o /dev/null -w "start: HTTP %{http_code}\n" -X POST $A/experiments/$EID/start
until [ "$(curl -s $A/experiments/$EID/status | jq -r .status)" != "running" ]; do sleep 3; done
curl -s $A/experiments/$EID/status | jq -c '{status, trials}'
```

Expected: `status` is `completed` and `trials` shows `succeeded: 5`. In our run all five judge trials passed (the agent's answers met the rubrics). Passing is not guaranteed for every config.

Read the judge's reasoning from one trial:

```bash
TID=$(curl -s "$A/trials?experimentId=$EID" | jq -r '[.[] | select(.taskId=="judge_email_01")][0].id')
curl -s $A/trials/$TID | jq '.grade.graderResults[] | {graderType, passed, score, reasoning, details: (.details | {rubricId, judgeModel, scores, failedRequired, attempts})}'
```

Expected: `graderType` is `llm_judge`, `reasoning` is a paragraph that quotes the answer, `scores` has one value per criterion, `rubricId` is `email_v1`, `judgeModel` is `google/gemini-2.5-flash`, and `attempts` is `1` when the first reply was valid JSON.

Stop the API when you are done.

### 9.4 What the judge changes in the earlier results

Before Phase 9, the 5 judge tasks failed with `grader_not_implemented`, which made the Phase 8 smoke run `partial`. With the judge, those tasks are graded instead of failing at the grader. Re-running the §8.4 smoke gives new totals; this README does not record a re-run of that smoke, so the 16/5 result above stays as the Phase 8 record.

### 9.5 Checkpoint 9b: the validation script prints κ

This step does not need the API. It calls the judge model directly for each of the 25 labels. Expect a few minutes and small API charges.

```bash
npx tsx scripts/validate-judge.ts | tee judge-validation.txt
echo "exit=$?"
```

The saved output is in `judge-validation.txt`. The numbers in this section come from three runs of the same rubric. Each run printed the same aggregates (below). Individual judge scores moved slightly between runs, for example `lbl_14` had an overall score of 0.71 in one run and 0.69 in another.

```
labels: 25, judged: 25, judge errors: 0

agreement rate: 92.0% (23/25)
Cohen's kappa:  0.826

confusion matrix (rows = human, columns = judge; positive = passed)
                 judge pass  judge fail
  human pass              8           1
  human fail              1          15

per task
  judge_bugreport_01   n= 5 agreement=100% kappa=1.00
  judge_email_01       n= 5 agreement=80% kappa=0.55
  judge_explain_01     n= 5 agreement=100% kappa=1.00
  judge_summary_01     n= 5 agreement=100% kappa=1.00
  judge_tradeoff_01    n= 5 agreement=80% kappa=0.62
```

κ = 0.826 is above the 0.6 threshold, so the verdict is acceptable on this set. The script exits 0.

### 9.6 The two disagreements

| Label | Task | Human | Judge | Why they differ |
|---|---|---|---|---|
| `lbl_14` | `judge_email_01` | pass (note: "Borderline pass: terse, but polite, with a reason and an alternative") | fail, overall 0.71. Unmet required: `one_sentence_reason` | The judge said the reason ("I'm at a customer site") is a separate clause, not part of the decline. The human counted it as one reason in one sentence. The same disagreement appeared in every run |
| `lbl_24` | `judge_tradeoff_01` | fail (note: "the recommendation bullet names a benefit and no cost, so it fails the per-bullet rule") | pass, overall 1.00 | The judge said every bullet names a cost. That is wrong for the recommendation bullet. This is a judge error on a rule the rubric states |

Both disagreements are kept as they are. The rubric was not edited to make them agree. Editing it to fit these two labels would tune the rubric on the validation set, and the κ would then say nothing about new answers. If you want to act on them, the next step is a rubric change plus a new set of labels that the change was not made against.

### 9.7 Results summary

- Agreement 92.0% (23/25). Cohen's κ 0.826, above the 0.6 threshold.
- Errors are split: one false negative (`lbl_14`, the judge is stricter than the human) and one false positive (`lbl_24`, the judge is more lenient than the human).
- Per task, `summary`, `explain` and `bugreport` agree on all 5 labels. `email` and `tradeoff` each have one disagreement, and their κ is 0.55 and 0.62. Those numbers are close to the threshold, and 5 labels per task is too few to rely on them.

### 9.8 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `judge_invalid_output` in a trial error | The judge returned non-JSON twice. The message names the first problem | Read the message. A persistent failure on one rubric means the prompt or the model needs work. Do not raise the retry count to hide it |
| `rubric_not_found` | A task's `rubricId` does not match any rubric in `rubrics.ts` | Fix the id. `validate-task-set.ts` lists the rubric ids it knows |
| Judge calls return 404 | The judge model is no longer served on OpenRouter | Change `judgeModel` in a new task version (bump `version`). Content cannot change under the same version |
| `validate-judge.ts` prints `judge errors: N` | Some labels could not be judged, so the metrics would be partial | Re-run. The script exits 1 when any label errors, so a partial run is never shown as passing |
| `validate-judge.ts` exits 1 with κ below 0.6 | The judge and the labels disagree too much | Tighten the rubric, or change the judge model, then re-run. Do not ship the judge as it is |

### 9.9 What this phase does not do

- **Judge tokens are not in the trial's metrics.** They are in `grade.graderResults[0].details.usage`. The trial's own token totals count only the agent.
- **No separate judge timeout.** The judge uses the adapter's 60 s timeout with 2 retries. A slow judge call shows up as a retryable infrastructure error.
- **Judge reasoning is not a trace event.** It is stored in the grade result, not in the trace file.
- **Validation runs are not stored in the database.** The design doc suggests storing them. `judge-validation.txt` is the record for now. Paste the numbers into `DESIGN.md` when that file exists (the plan puts it in a later phase).
- **The judge's replies can vary between runs.** Temperature 0 does not guarantee identical output. The aggregates were identical across three runs, but single scores moved by about 0.02.
- **κ is measured on 25 labels, from one author.** I wrote the labels, and the rubric and labels were written in the same session. That is a circularity risk. Relabel a sample blind before you trust the number. One label changes the agreement by 4 points.
- **Judge and agent are different families**, so the judge does not grade its own family's output. That reduces one bias. It does not remove position, length, or wording bias, and the rubrics here do not test for those.
- **Commit:** the work is uncommitted, as in earlier phases.

## Phase 10 — Statistics package and the compare endpoint

**Goal:** Answer "A vs B" with intervals, and say so when the difference is noise. Aggregate scores hide regressions, so the endpoint also returns per-task deltas.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 10.0 What changed in this phase

| Area | Change |
|---|---|
| `packages/stats` | New package, pure functions with no dependencies: `passRate`, `wilsonInterval`, `bootstrapMeanCI`, `pairedBootstrapDelta`, `mcNemar`, and `compareConfigs` (the A/B analysis). Seeded resampling, so results are reproducible |
| `apps/api` | `GET /experiments/:id/compare?a=&b=`. The service selects the two configs' trials, `compare-input.ts` splits them into scored and excluded, and `compareConfigs` does the analysis |
| `fixtures/stats/` | `known_gap.json` (A passes ~90%, B ~40%) and `coin_flip.json` (both ~50%). 20 tasks × 5 paired trials each. Seeds 101 and 202 were fixed before the results were looked at |
| `scripts/stats-fixtures.ts` | Checks both fixtures (exit 0 when both behave as expected). `--generate` rewrites the JSON |
| root `package.json` | `build:packages` builds `stats`. Run `npm install` once so the workspace link exists (`node_modules/@agent-evals/stats`) |

### 10.1 Install and build

```bash
npm install
npm run build:packages
```

If npm reports `SELF_SIGNED_CERT_IN_CHAIN`, use `NODE_OPTIONS=--use-system-ca npm install` (see Phase 6). The install adds a workspace entry to `package-lock.json`.

### 10.2 Offline tests (no key, no network)

```bash
npm test
```

Expected: nine workspaces pass. `stats` runs 31 tests: the hand-checked vector from the plan (`A = [1,1,0,1,0]`, `B = [1,0,0,0,0]`) gives a delta of +0.4, and McNemar gives p = 0.5 (two discordant pairs, both favouring A). Other tests cover the Wilson interval at 0 and n passes, the exact McNemar tail, the comparison rules, and the two fixtures.

### 10.3 Checkpoint 10a: the known gap is significant, the coin flip is noise (expect OK twice)

```bash
npx tsx scripts/stats-fixtures.ts
echo "exit=$?"
```

Expected output (from our run, which is deterministic because the fixtures and the bootstrap seed are fixed):

```
known_gap
  macro pass rate  A 0.950  B 0.370  delta 0.580
  delta 95% CI     [0.480, 0.670]
  McNemar p        0.0000  (discordant A-only 59, B-only 1)
  verdict          a_better  noise=false
  expected         OK

coin_flip
  macro pass rate  A 0.500  B 0.410  delta 0.090
  delta 95% CI     [-0.100, 0.270]
  McNemar p        0.2529  (discordant A-only 29, B-only 20)
  verdict          likely_noise  noise=true
  expected         OK
```

`exit=0`. The coin flip has a 9-point gap in its raw rates, and the interval still spans 0, so the verdict is noise. That is the point of the check.

To rebuild the fixtures from their seeds: `npx tsx scripts/stats-fixtures.ts --generate`.

### 10.4 Checkpoint 10b: compare two configs on a live experiment

The API must be running (`npm run start:dev -w @agent-evals/api`) and the judge tasks seeded (Phase 9 §9.3). This creates a second config with a tight token budget (`maxTokens` 60, against 4096 for the Phase 9 base config). The judge answers are long enough that the tight budget cuts them short, so B should lose:

```bash
A=http://localhost:3000
BASE=$(curl -s $A/configs | jq -r '.[] | select(.name=="p9-judge-base") | .id')
TIGHT=$(curl -s -X POST $A/configs -H 'content-type: application/json' -d '{
  "name": "p10-tight-budget",
  "harness": { "id": "baseline", "settings": {
    "skillsEnabled": [], "memory": { "enabled": false, "persistAcrossTrials": false },
    "tools": ["read_file", "write_file", "list_dir"], "maxSteps": 8, "maxTokens": 60, "timeoutMs": 60000 } },
  "model": { "provider": "openrouter", "modelId": "openai/gpt-4.1-mini", "temperature": 0 }
}' | jq -r .id)

EXP=$(curl -s -X POST $A/experiments -H 'content-type: application/json' \
  -d "{\"name\":\"p10-compare-check\",\"hypothesis\":\"a tight token budget hurts judge tasks\",\"taskIds\":[\"judge_summary_01\",\"judge_explain_01\",\"judge_email_01\",\"judge_bugreport_01\",\"judge_tradeoff_01\"],\"configIds\":[\"$BASE\",\"$TIGHT\"],\"nTrials\":4}" | jq -r .id)
curl -s -o /dev/null -w "start: HTTP %{http_code}\n" -X POST $A/experiments/$EXP/start
until [ "$(curl -s $A/experiments/$EXP/status | jq -r .status)" != "running" ]; do sleep 3; done
curl -s $A/experiments/$EXP/status | jq -c '{status, trials}'

curl -s "$A/experiments/$EXP/compare?a=$BASE&b=$TIGHT" | jq '{verdict, noise, commonTasks, pairedTrials, delta, a: {passRate: .a.passRate, passRateCI: .a.passRateCI}, b: {passRate: .b.passRate, passRateCI: .b.passRateCI}}'
curl -s "$A/experiments/$EXP/compare?a=$BASE&b=$TIGHT" | jq -r '.perTask[] | [.taskId, .passRateA, .passRateB, .delta] | @tsv'
```

Expected: the status is `completed` with 40 succeeded trials. The compare shows `verdict: "a_better"`, `noise: false`, and a delta CI that excludes 0. In our run, the delta was +0.75 with CI [0.35, 1.00], McNemar p ≈ 0.00006 (15 A-only discordant pairs and 0 B-only), and the per-task table was:

| Task | A (base) | B (tight) | Delta |
|---|---|---|---|
| `judge_bugreport_01` | 1.00 | 0.00 | +1.00 |
| `judge_email_01` | 1.00 | 0.00 | +1.00 |
| `judge_explain_01` | 1.00 | 0.25 | +0.75 |
| `judge_summary_01` | 1.00 | 1.00 | 0.00 |
| `judge_tradeoff_01` | 1.00 | 0.00 | +1.00 |

We checked the mechanism in the trace files. All 16 tight-budget answers for the four tasks that fail stop mid-sentence (for example "…Could we reschedule it to Tuesday at 10am next week" and "…Click the"). The tight answers are capped at about 240–350 characters, roughly the 60-token budget. So the judge fails them for being incomplete, which is a real regression from the config. The numbers come from one run of a live model. A rerun can move them, though this gap is large.

`judge_summary_01` is the only task where both configs pass. Its answers fit inside the budget in both configs (243–262 characters), so the config makes no difference there. That is the per-task view doing its job: the aggregate says B is worse, and the table says where.

**Reading the response**

| Field | Meaning |
|---|---|
| `delta.value` | Macro pass rate of A minus B. Positive means A is better |
| `delta.ci` | Paired bootstrap CI over tasks. Resampling tasks, not trials, because trials of one task are not independent |
| `delta.pValue` | Exact McNemar p-value on the paired trials, `(task, trialIndex)` |
| `delta.discordant` | Paired trials where only A passed (`aOnly`) or only B passed (`bOnly`) |
| `noise` | `true` when the delta CI includes 0, or when there are fewer than 2 common tasks |
| `verdict` | `a_better`, `b_better`, `likely_noise`, or `insufficient_data` |
| `a.passRate`, `a.passRateCI` | Macro pass rate (each task counts once) and its task-level bootstrap CI |
| `a.meanLatencyMs`, `a.meanTotalTokens`, `a.meanCostUsd` | Means over scored trials that have the metric. Cost is `null` until the runner computes it (it does not yet) |
| `a.excluded` | Trials that did not reach a verdict: `failed`, `cancelled`, `pending` |
| `perTask` | Per-task pass rates and delta, for tasks both configs scored |
| `notes` | Plain-language warnings, such as excluded counts or too few tasks |

### 10.5 Decisions in this phase

- **The unit is the task.** The macro pass rate averages per-task rates, so a task with 10 trials does not outweigh one with 2. The delta CI resamples tasks.
- **Timeouts count as fails.** A config that exceeds its time budget did not finish, and that is a property of the config. Infrastructure failures (`failed`) and `cancelled` trials are excluded and reported, so they cannot lower a config's pass rate.
- **The verdict uses the CI, not the p-value.** The CI accounts for task-to-task variation. McNemar treats trials as independent, which makes it optimistic when trials cluster by task. Read the p-value as a secondary signal.
- **Delta is A minus B.** Positive means A is better.
- **Pairing is by `(taskId, trialIndex)`.** Seeds differ between configs by design (they are derived from the config id), so they cannot be used to pair.
- **Small samples say so.** With one common task the response returns `insufficient_data` and no interval, and it does not guess.

### 10.6 Troubleshooting

| Response | Cause | Fix |
|---|---|---|
| `400` with `config is not part of this experiment` | `a` or `b` is not in the experiment's `configIds` | Use the config ids from the experiment. Configs are not compared across experiments |
| `400` with `a and b must be different configs` | Both query parameters name the same config | Pass two different config ids |
| `400` on a missing `a` or `b`, or a bad UUID | A query parameter is missing or not a UUID | Pass both `a=` and `b=` as config UUIDs |
| `409` with `no task has a scored trial for both configs` | No task has a scored trial on both sides yet | Wait for the trials to finish (`/status`), or check that both configs ran the same tasks |
| `verdict: "insufficient_data"` | Fewer than 2 common tasks | Add tasks. One task cannot give an interval |
| `meanCostUsd: null` | The runner does not compute `estimatedCostUsd` | Expected for now. Cost reporting needs a price table, which is not in this project |
| `pending` count above 0 in `excluded` | Trials are still queued or running | Wait for `status` to be `completed`, then compare again |

### 10.7 What this phase does not do

- **The plan's manual exercise (A always answers 42, B answers 41) is not run as written.** The API has no mock model, and the offline fixtures cover the same question directly. The tight-budget config is a live check of a real regression.
- **No multiple-comparison correction.** Per-task rows are descriptive. With 20 tasks and 4 trials each, some per-task deltas will look large by chance, so the table does not come with per-task p-values.
- **No UI.** The compare view is Phase 11.
- **No cost.** The runner does not compute `estimatedCostUsd`, so cost comparisons are null.
- **The p-value assumes independent trials.** The CI is the primary evidence, as §10.5 says.
- **Two configs per call.** `compare` takes exactly two configs from one experiment.
- **No persisted results.** The compare is computed from the trials on each request.

## Phase 11 — Vue UI for the workflow

**Goal:** Click the same loop you have been curling: tasks, configs, experiments, compare, trial inspector.

Run every command from the repo root:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 11.0 What changed in this phase

| Area | Change |
|---|---|
| `apps/web` | Replaced the Vite template with five pages (tasks, configs, experiments, compare, trial inspector) and a small API client. Uses `vue-router` (new dependency) |
| `apps/web/vite.config.ts` | Dev proxy: the browser calls `/api/...` and Vite forwards to the API on port 3000 with the `/api` prefix removed. The API has no CORS. The prefix also keeps API paths (`/tasks`, `/configs`) apart from the UI's routes, which use the same names. `API_URL` overrides the target |
| `apps/web/src/lib` | Pure helpers with unit tests: CSV export (formula-safe), form-to-request builders (config and experiment), trace timeline, trial outcome labels, number formatting |
| `apps/api` | New `GET /experiments`, newest first. The Experiments page lists from it. Nothing else in the API changed |
| `apps/web/src/pages/pages.spec.ts` | Server-renders each page's first state through the router. This catches template errors, not data flow |

Trials in the UI: outcomes follow §7.8. A scored failure (the agent answered wrong) is shown as "Failed (scored)". An infrastructure failure is shown separately as "Infrastructure failure".

### 11.1 Install and build

```bash
npm install
npm run build:packages
npm run build -w @agent-evals/web
```

`npm install` adds `vue-router` and the workspace links for `@agent-evals/domain` and `@agent-evals/stats` (type imports only). The web build runs `vue-tsc` with strict type checks and then `vite build`.

### 11.2 Offline tests (no key, no network)

```bash
npm test
```

Expected: ten workspaces pass. `web` runs 29 tests: the helper tests, and the first-render smoke test for each page. The smoke test does not call the API.

### 11.3 Start the stack

Postgres and Redis must be running (Phase 6 and 7):

```bash
docker compose up -d db redis
npm run start:dev -w @agent-evals/api
```

In a second terminal, start the UI:

```bash
npm run dev -w @agent-evals/web
```

Open http://localhost:5173. Port 5173 is Vite's default. The UI reaches the API through the proxy, so no CORS setup is needed. If the API is on another port, set `API_URL`, for example `API_URL=http://localhost:3001 npm run dev -w @agent-evals/web`.

The proxy only exists in `vite` dev mode. `vite preview` and a production build need the same `/api` prefix routed to the API some other way. That is not set up.

### 11.4 The pages

| Page | URL | What it does |
|---|---|---|
| Experiments | `/experiments` | Lists experiments, newest first. The form creates one from chosen tasks (latest version of each), chosen configs, and trials per cell. Creating does not start it |
| Experiment | `/experiments/:id` | Status and trial counts. **Start** is enabled only while the experiment is `pending`. While it runs, the page refreshes every 3 s. **Export CSV** downloads the trials in the table. **Compare configs** appears when there are two or more configs |
| Compare | `/experiments/:id/compare` | Pick two configs from the experiment (A and B). Shows the verdict, each side's macro pass rate, the difference (A minus B) with its 95% interval and McNemar p-value, the per-task table, mean latency and tokens, and the excluded counts. Cost shows as a dash when it is not measured |
| Trial | `/trials/:id` | Outcome, grader results with the judge's reasoning, metrics, error, the agent's final answer, the trace as a timeline with offsets, and a notes box |
| Configs | `/configs` | The saved configs, and a form that creates one. Saving the same settings again reports that nothing new was created |
| Tasks | `/tasks` | One row per task version, with tags and grader types |

Notes in the trial page are saved in this browser only (`localStorage`, keyed by trial id). They are not sent to the API.

### 11.5 Checkpoint 11: the drill, without curl

The plan's drill is the checkpoint. Do it in the browser:

1. **Configs** page: create **A** (memory off) and **B** (memory on). Leave the base tools on. A new config shows "Created … version N." Saving the same settings again shows "An identical config already exists … Nothing new was created."
2. **Experiments** page: name the experiment, pick two tasks, pick both configs, and set trials per cell to 3. Create it. You land on the experiment page. Creating does not start it.
3. On the experiment page, press **Start**. The counts update every 3 s while the status is `running`. It stops at `completed`, `partial`, or `failed`. Expect 12 trials.
4. Open a failed trial. In our run, A failed all three `mem_recall_client_01` trials, and B passed all three. The trial page shows `exact_match` expected `HL-2044`, got "There is no client ID stored in the memory." The trace has three events (`step_boundary`, `message`, `message`) and no tool calls, so the agent never searched memory. Write three bullets in the notes box.
5. Press **Export CSV** on the experiment page. The file has a header and one line per trial.
6. Press **Compare configs**. Set Config A to B (memory on) and Config B to A (memory off). Delta is A minus B, so a positive delta means memory helped. Read the verdict.

**The verdict for this drill is "Likely noise", and that is the correct answer for two tasks.** The 95% interval resamples tasks, and two tasks cannot narrow it. In our run the delta was +0.50 with interval [0.00, 1.00], p = 0.25. The memory effect is real for the one task it targets, but this experiment cannot show it statistically. For a verdict you can act on, add tasks: five or more, with several trials each. Phase 10 §10.5 explains the interval.

### 11.6 What was checked here, and what you check

Checked in this phase:

- The web app builds with strict `vue-tsc` and `vite build`.
- 29 web tests pass: the helpers, and the first-render smoke test of each page.
- The API lint and typecheck pass. All API tests still pass (35).
- The dev proxy works: the SPA route serves the app, `/api/tasks`, `/api/configs` and `/api/experiments` return data, and API error messages reach the browser.
- The config bodies that `buildConfigInput` produces are accepted by the API (201 each), and the experiment created with the UI's body ran to completion (12 trials).
- The trace timeline and the CSV export, run on a real failed trial and a real trial list.

**Not checked here: clicking through the pages in a browser.** The smoke test shows that each page renders its first state. It does not click buttons, and it does not run the polling or the file download. Run the drill in §11.5 to confirm those.

### 11.7 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A page shows a request error (for example, "fetch failed" or a connection error) | The API is not running on port 3000, or `API_URL` is wrong | Start the API. Check `API_URL` |
| The create form says "No tasks. Seed them with npm run seed:tasks." | The tasks are not seeded | `npm run seed:tasks` (the API must be running) |
| **Start** is disabled | The experiment is no longer `pending`: it is running or has finished | Each experiment runs once. Create a new experiment to run again |
| **Compare configs** does not appear | The experiment has only one config | Create the experiment with two configs |
| The compare page shows "Not enough data" | Fewer than two tasks have scored trials on both configs | Add tasks, then run them |
| The compare page shows a 409 error | No task has a scored trial on both configs yet, often because the trials are still running | Wait for the status to leave `running`, then compare again |
| Trace says "Trace could not be loaded" | The trace file is missing, or the trial has no trace (`hasTrace` is false) | Check `data/traces/`, or `TRACE_DIR` if it is set. A trial that never reached the agent has no trace |
| The notes disappeared | They are saved in the browser. A different browser, or cleared site data, has no notes | Notes are local by design |

### 11.8 What this phase does not do

- **No authentication.** The API has none, and the UI has none.
- **No production serving.** The API proxy exists only in the dev server.
- **No browser end-to-end tests.** The smoke test renders pages without a browser or an API.
- **No pagination or filters.** Lists show everything. That is fine at this size.
- **No charts.** The compare page is tables and badges. Charts are not planned.
- **Notes are not part of the data.** They stay in the browser, not in the trial record.
- **The compare page does not refresh.** Press **Compare** again after the trials finish.
- **Cost is still a dash.** The runner does not compute cost yet (Phase 10 §10.7).

## Phase 12 — Second harness: Hermes

**Goal:** Prove the abstraction. Hermes Agent runs as a second harness behind the same `HarnessAdapter` interface. The runner, graders, trace, stats, sandbox, and API do not change. Only an adapter is added.

Run every command from the repo root unless a step says otherwise:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 12.0 What changed in this phase

| Area | Change |
|---|---|
| `workers/python-worker` | Hermes Agent (`hermes-agent==0.19.0`) as a dependency. New modules under `src/agent_evals_python_worker/`: `contract.py` (request and response), `settings.py`, `sandbox.py` (path rules ported from `packages/sandbox`), `tools.py` (the six tools, same names, schemas, and error strings as the baseline), `events.py` (trace events), `hermes_runner.py` (runs one trial), `server.py` (the HTTP routes). `app/main.py` now re-exports the app, so the `dev:worker:python` command is unchanged |
| `workers/python-worker/tests` | 35 pytest tests. They run Hermes's real tool loop against a scripted fake OpenAI endpoint. No network |
| `packages/adapters-harness` | `hermes.ts` (`HermesHarness`, an HTTP client for the worker). The registry maps `hermes` to it. 9 new Node tests (8 in `hermes.spec.ts`, 1 for the registry) |
| `scripts/run-one-trial.ts` | New `--max-tokens <n>` flag. The default stays 256 (see 12.5, why it matters here) |
| `.gitignore` | `workers/python-worker/.hermes-home/`, the Hermes state directory |

The core packages (`domain`, `runner`, `trace`, `stats`, `sandbox`, `graders`, `adapters-model`) and `apps/api` have no changes in this phase.

### 12.1 Install

```bash
cd workers/python-worker
UV_SYSTEM_CERTS=1 uv sync --all-groups
cd ../..
```

`UV_SYSTEM_CERTS=1` makes `uv` trust the system certificate store. Use it behind a corporate proxy that re-signs TLS. Without it, the download fails with a certificate error.

Hermes requires Python `>=3.11,<3.14` and pins `pydantic==2.13.4` exactly. The project therefore pins that same version. The earlier `>=2.14.4` cannot resolve together with Hermes.

### 12.2 Start the worker

The worker reads `OPENROUTER_API_KEY` from the repo-root `.env`, the same file the Node side reads. Start it in its own terminal and keep it running:

```bash
npm run dev:worker:python
```

The worker listens on port 8001 and reloads on file changes. Health check, from another terminal:

```bash
curl -s localhost:8001/health
# {"ok":true,"worker":"python"}
```

The Node side finds the worker at `HERMES_WORKER_URL`, which defaults to `http://127.0.0.1:8001`.

### 12.3 The contract: `POST /run-trial`

Request (the Node side builds this in `packages/adapters-harness/src/hermes.ts`):

```json
{
  "trialId": "trial-…",
  "task": { "id": "det_add_01", "prompt": "What is 17 + 25? Reply with only the number." },
  "config": { "modelId": "openai/gpt-4.1-mini", "temperature": 0, "maxSteps": 10, "maxTokens": 8000, "timeoutMs": 60000 },
  "toolIds": [],
  "memorySeed": {},
  "sandboxDir": "/tmp/…",
  "seed": 0
}
```

Response:

```json
{
  "finalAnswer": "42",
  "stoppedReason": "completed",
  "events": [ { "ts": "…", "type": "message", "role": "user", "content": "…" } ],
  "usage": { "promptTokens": 148, "completionTokens": 3 },
  "stepCount": 1
}
```

The plan's sketch had `{trialId, task, config, sandboxDir, seed}`. Two fields were added: `toolIds` (which tools this trial may use) and `memorySeed` (the task's starting memory). The runner needs both, and the plan's sketch had no place for them.

`events` use the same shape as `TraceEventSchema` in `packages/domain`. The Node side checks every event with that schema before it emits it. A bad event fails the trial as an infrastructure error.

Errors: an unreachable worker is `hermes worker unreachable at <url>`. A worker error is `hermes worker returned <status>: <detail>`. Both are infrastructure errors, so the runner retries them (§7.8).

### 12.4 How the config maps to Hermes

| Config or task field | What the worker does |
|---|---|
| `harness.id: "hermes"` | The registry returns `HermesHarness`. Nothing else in the API changes |
| `tools` and the task's `toolsAllowed` | Become `toolIds`. Hermes gets a toolset built from exactly those tools. The model is offered no other tools |
| `memory.enabled` | Adds `memory_read` and `memory_write` to `toolIds`. The trial's memory starts from `task.setup.memory`. Hermes's own memory store is off (`skip_memory=True`), so the trial's memory is the only one |
| `skillsEnabled` | Adds the skill's tools to `toolIds`. Today the only skill is `csv_summary` |
| `temperature`, `topP` | Sent to OpenRouter in the request body (Hermes's `request_overrides`) |
| `maxSteps` | Hermes's `max_iterations`. At the limit the loop stops. Hermes's extra summary call is turned off, so the step budget is hard, as in the baseline |
| `maxTokens` | Per-call `max_tokens`. The trial's total (prompt plus completion, across all calls) is checked before each call. Past the budget the trial stops with `max_tokens` |
| `timeoutMs` | A timer calls Hermes's `interrupt()`. The trial stops with `timeout` |
| Tool calls | Hermes calls our handler, with the trial found by `task_id`. Each call runs in the trial's sandbox. Memory calls use the trial's memory |
| `skill_invoke`, `memory_read`, `memory_write` | Emitted after a successful call of that tool, as the baseline does |

Hermes's events are rebuilt from its conversation, in the baseline's order: a `step_boundary` before each model call, then the `message` and `tool_call` / `tool_result` pairs. Timestamps come from Hermes's callbacks.

### 12.5 Checkpoint 12: the same task under both harnesses

The plan's checkpoint is that the same task runs under `baseline` and `hermes`, without changing the Orchestrator. Run one task under each harness:

```bash
npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json --model openrouter:openai/gpt-4.1-mini --harness baseline --max-tokens 8000
npx tsx scripts/run-one-trial.ts tasks/deterministic/01_add.json --model openrouter:openai/gpt-4.1-mini --harness hermes --max-tokens 8000
```

Both print the same report: the verdict, the grader line, the stop reason, the usage, and the trace path. Results from the run recorded for this phase (one run each, `temperature` 0):

| Task | Harness | Budget | Verdict | Stopped | Steps | Total tokens |
|---|---|---|---|---|---|---|
| `01_add` | baseline | 256 | PASS (42) | completed | 1 | 151 |
| `01_add` | hermes | 256 | FAIL (empty answer) | max_tokens | 2 | 2,529 |
| `01_add` | baseline | 8000 | PASS (42) | completed | 1 | 151 |
| `01_add` | hermes | 8000 | FAIL (empty answer) | max_tokens | 5 | 10,436 |
| `mem_recall_client_01` (`--memory`) | baseline | 8000 | PASS (HL-2044) | completed | 2 | 579 |
| `mem_recall_client_01` (`--memory`) | hermes | 8000 | PASS (HL-2044) | completed | 2 | 5,254 |
| `skill_csv_sum_01` (`--skill csv_summary`) | baseline | 8000 | PASS (11846) | completed | 2 | 692 |
| `skill_csv_sum_01` (`--skill csv_summary`) | hermes | 8000 | FAIL (answered `11846.0`) | completed | 2 | 5,375 |

What these show:

- **The platform side works under Hermes.** Every Hermes trial went through the same runner, sandbox, graders, trace writer, and result file. The memory trial emitted a `memory_read` event. The skill trial emitted a `skill_invoke` event with `skillId: csv_summary`. The tools were limited to the trial's `toolIds`.
- **Hermes's behavior differs from the baseline, and the difference is large.** Hermes uses its own system prompt and about 2.4k prompt tokens per call. The baseline sends no system prompt. On `01_add`, the model writes a Python file and then reads it back, over and over, when it should just answer. The trial then runs out of budget with no answer. With the default 256 budget, the first call alone uses most of the budget, so the trial stops at step 2.
- **The skill miss is formatting, not a tool error.** Both harnesses called the same tool and got the same result. Hermes wrote `11846.0`, and the exact-match grader expects `11846`.

This is the abstraction working as designed, not a bug to hide. The adapter can run any harness, and each harness brings its own behavior. Whether Hermes should be stripped to match the baseline (no system prompt, no tool-first instructions) is a choice, and it is listed in §12.9.

### 12.6 Checkpoint 12: the core packages do not know about Hermes

```bash
rg -n -i "hermes" packages/domain/src packages/runner/src packages/trace/src packages/stats/src packages/sandbox/src packages/graders/src packages/adapters-model/src apps/api/src
```

Expected: no output (exit code 1). Recorded for this phase: no output. The only Hermes code is in `packages/adapters-harness` (`hermes.ts`, its spec, and the registry entry) and in `workers/python-worker`.

The runner and the API still typecheck:

```bash
npx tsc -p packages/runner/tsconfig.json --noEmit && npx tsc -p apps/api/tsconfig.json --noEmit && echo "core typecheck ok"
```

Expected: `core typecheck ok`. Recorded for this phase: passes.

### 12.7 Checks

Python suite (no key, no network):

```bash
cd workers/python-worker
UV_SYSTEM_CERTS=1 uv run pytest
uv run ruff check . && uv run ruff format --check .
cd ../..
```

Expected: `35 passed`, ruff clean. The tests are `test_sandbox.py` (path rules), `test_tools.py` (tool names, schemas, error strings), `test_events.py` (event order), `test_run_trial.py` (the real Hermes loop against a scripted endpoint: the tool loop, refused tools, memory seeding and isolation, `max_steps` (exactly two chat requests), `max_tokens`, timeout, a model error, a missing key), and `test_ssl_guard.py` (see 12.9 item 6).

Node suite:

```bash
npm test
```

Expected: ten workspaces pass. `adapters-harness` is now 52 tests (was 43). The `hermes.spec.ts` tests use a fake worker and check the request body, event order, the `topP` handling, invalid events, a 500 response, a malformed reply, a non-JSON reply, an unreachable worker, the environment variable, and the trailing slash.

### 12.8 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `hermes worker unreachable at http://127.0.0.1:8001: fetch failed` | The worker is not running | Start it (§12.2) and check the health endpoint |
| `hermes worker returned 500: … OPENROUTER_API_KEY is not set` | The key is missing from the repo-root `.env` | Add `OPENROUTER_API_KEY=…` to `.env` and restart the worker. Settings are read at startup |
| `hermes worker returned 500: … Failed to initialize OpenAI client` | Hermes's CA-bundle check cannot run on truststore's SSL context (§12.9 item 6) | The worker sets `HERMES_SKIP_SSL_GUARD=1` for this. If you see it, the worker was started from code that lacks that line |
| A certificate error from `uv` or Node | A corporate proxy re-signs TLS | `UV_SYSTEM_CERTS=1` for `uv`, and `NODE_OPTIONS=--use-system-ca` for Node |
| `Failed to spawn: pytest` after the repo moved | The `.venv` shebangs point at the old path | `cd workers/python-worker && rm -rf .venv && UV_SYSTEM_CERTS=1 uv sync --all-groups` |
| `stopped: max_tokens` with an empty answer | The 256-token default is too small for Hermes's prompt | Use `--max-tokens 8000` on both harnesses for a fair comparison |
| Port 8001 already in use | Another worker is still running | `lsof -tiTCP:8001 -sTCP:LISTEN` and stop it, then start again |

### 12.9 Deviations from the baseline, and why

These are the differences a reader needs to know before comparing results:

1. **Hermes's system prompt and tool instructions.** Hermes sends its own system prompt, and it steers the model toward acting with tools. The baseline sends none. This is the largest difference (see 12.5). It is not removed, because Hermes's behavior is what this harness is for. Removing it would make Hermes a different harness.
2. **Hermes's other tools are not exposed.** Its terminal, web, and other built-in tools stay off. Each trial gets only its `toolIds`. Hermes's `read_file` and `write_file` are replaced by our sandboxed versions, which keep the baseline's names and rules.
3. **Hermes's own memory and context files are off** (`skip_memory`, `skip_context_files`). The trial's memory is the only memory.
4. **The token budget counts Hermes's prompt.** `maxTokens` is prompt plus completion, across all calls. Hermes's prompt is about 2.4k tokens per call, so a small budget is used up by the prompt alone.
5. **`seed` is not used.** Hermes does not take a seed.
6. **`truststore` and `HERMES_SKIP_SSL_GUARD`.** The worker injects `truststore` so the model calls use the system certificate store. That is needed behind a corporate proxy. Hermes then checks the CA bundle by calling `SSLContext.get_ca_certs()`, and truststore's context does not implement that call. So Hermes fails to build its client with "Failed to initialize OpenAI client". The worker sets `HERMES_SKIP_SSL_GUARD=1` to skip that preflight check only. The real TLS path still uses the system roots. `test_ssl_guard.py` covers this.
7. **Pydantic pin.** `pydantic==2.13.4`, to match Hermes's exact pin (see 12.1).
8. **Events are emitted after the run.** They are rebuilt from Hermes's conversation, with timestamps from its callbacks. They are not streamed while the trial runs.
9. **Timeouts are enforced in two places.** Python interrupts Hermes at `timeoutMs`. The Node runner also wraps the call in its own timeout. The Node `fetch` has no abort, so a worker call that outlives the runner's timeout finishes in the background and its result is discarded.
10. **Hermes keeps state on disk.** Each worker process keeps its state in `workers/python-worker/.hermes-home/`, which is gitignored. It is never `~/.hermes`. Each trial's conversation is stored in that directory's `state.db`. Trials are isolated by their own toolset and by `task_id`, not by separate processes.
11. **One worker process, many trials.** Trials can run concurrently in one worker. The tool handlers find the trial by `task_id`, and the state is kept under a lock.
12. **`--max-tokens` on the CLI.** This phase adds the flag, with the old 256 as the default, so the baseline's CLI behavior is unchanged.

### 12.10 What this phase does not do

- **The web UI only creates `baseline` configs.** `apps/web/src/lib/forms.ts` hard-codes `harness.id: 'baseline'`. A Hermes config can be created through the API (`POST /configs` with `"harness": {"id": "hermes", …}`) but not from the Configs page. That is a follow-up.
- **The live checkpoint is one run per cell.** The table in 12.5 is a record of one run each. It is not a benchmark, and the results vary between runs.
- **No cost.** The runner does not compute cost yet (§10.7).
- **Only `csv_summary` is wired as a skill.** Hermes's built-in tools are not exposed (§12.9 item 2).

## Phase 13 — Second model, export, and the full stack in Docker

**Goal:** A second model runs beside the first, the results export as JSON and CSV, and the whole system starts with one command and one `.env` file.

Run every command from the repo root unless a step says otherwise:

```bash
cd /Users/turing-satyam/work/beyond/task/agent-evals
```

### 13.0 What changed in this phase

| Area | Change |
|---|---|
| `apps/api` | `GET /experiments/:id/export?format=json\|csv`. New `experiments/export.ts` (pure functions, CSV escaping shared with the web's rule) and `export.spec.ts`. `trials.service.ts` exports its trial mapper so the export and `GET /trials` return the same trial shape |
| `apps/api/src/worker.ts` | A trial consumer without HTTP (`npm run build -w @agent-evals/api`, then `npm run start:worker -w @agent-evals/api`). The API runs with `TRIAL_WORKER=off` and this process consumes the queue |
| `Dockerfile.node` | One image for the API, the worker, and the seeder. Built from the whole monorepo (npm workspaces need every package) |
| `apps/web/Dockerfile`, `apps/web/nginx.conf` | Builds the Vue app, serves it with nginx, and forwards `/api/...` to the API with the prefix removed (same routing as the Vite dev proxy) |
| `workers/python-worker/Dockerfile`, `.dockerignore` | The Hermes worker image. Installs `uv.lock` with `--frozen --no-dev` |
| `docker-compose.yml` | Adds `api`, `worker`, `seed`, `python-worker`, `web`, with health checks and dependencies. `db` and `redis` keep their ports |
| `.dockerignore` (root) | Keeps `.env`, `node_modules`, `data/`, and build output out of the images |
| `workers/python-worker/src/.../settings.py` | Fixed the repo-root path. It assumed the source-tree depth and failed inside the image (see 13.5) |
| `.env.example` | Lists the optional host-port variables that compose reads |

Nothing in `packages/` changed.

### 13.1 Second model

The plan's example, `anthropic/claude-3.5-haiku`, is no longer served by OpenRouter. A trial against it returned `404 ... no provider serves this model anymore`. This phase uses `anthropic/claude-haiku-4.5`, the current Haiku, which passed a live trial. Any other OpenRouter model id works the same way.

Create the second config in the Configs page (the model field is free text) or with curl:

```bash
curl -s -X POST localhost:3000/configs -H 'content-type: application/json' -d '{
  "name": "claude-haiku-4.5 baseline",
  "harness": { "id": "baseline", "settings": { "skillsEnabled": [], "memory": { "enabled": false, "persistAcrossTrials": false }, "tools": [], "maxSteps": 6, "maxTokens": 1000, "timeoutMs": 120000 } },
  "model": { "provider": "openrouter", "modelId": "anthropic/claude-haiku-4.5", "temperature": 0 }
}'
```

Use `maxTokens` 1000 for a small check. The key used here could not afford an 8000-token request to Haiku. OpenRouter reserves the requested output tokens at the model's price, and it answered `402 ... can only afford 4523`. A smaller budget fits.

### 13.2 Export

```bash
curl -s "localhost:3000/experiments/<ID>/export?format=json" -o exp.json
curl -s "localhost:3000/experiments/<ID>/export?format=csv" -o exp.csv
```

- **JSON** (default): `{ experiment, configs, trials }`. Each config carries `name`, `version`, `contentHash`, `harnessId`, `provider`, `modelId`, and `temperature`, so the file says which model and harness produced each trial.
- **CSV**: one row per trial, with the columns in `TRIAL_EXPORT_COLUMNS` (`apps/api/src/experiments/export.ts`). Each row carries `configName`, `harnessId`, and `modelId`, so a file with two models stays readable without the JSON.
- Both responses set `Content-Disposition: attachment`, so a browser downloads them.
- Errors: `format` other than `json` or `csv` is 400. An unknown experiment is 404. A value that is not a UUID is 400.
- `estimatedCostUsd` is blank. The runner does not measure cost yet (§10.7).
- The Experiment page's own CSV button is unchanged. It still builds the file in the browser from `/trials`.

### 13.3 The full stack

**Install and start.** You need Docker and a `.env` file:

```bash
cp .env.example .env          # then set OPENROUTER_API_KEY
docker compose up --build     # add -d to run in the background
```

The first build also downloads the base images, so it is slower. Later builds reuse cached layers.

| Service | Image | Port (host) | What it runs |
|---|---|---|---|
| `db` | `postgres:16` | `5432` (or `POSTGRES_HOST_PORT`) | Postgres, healthy when `pg_isready` passes |
| `redis` | `redis:7` | `6379` (or `REDIS_HOST_PORT`) | Redis, healthy when `redis-cli ping` passes |
| `api` | `Dockerfile.node` | `3000` (or `API_HOST_PORT`) | The API. `TRIAL_WORKER=off`, so it queues trials but runs none |
| `worker` | `Dockerfile.node` | none | Consumes the trial queue. Waits for `api` and `python-worker` to be healthy |
| `python-worker` | `workers/python-worker/Dockerfile` | `8001` (or `PYTHON_WORKER_HOST_PORT`) | The Hermes harness. Healthy on `/health` |
| `seed` | `Dockerfile.node` | none | Loads the 21 tasks into the API, then exits with 0. Running it again reports them as unchanged |
| `web` | `apps/web/Dockerfile` | `5173` (or `WEB_HOST_PORT`) | The UI, served by nginx. `/api/...` goes to the API |

Services find each other by name (`db`, `redis`, `api`, `python-worker`). Their addresses come from the compose file, not from `.env`, which still says `localhost` for runs on the host.

Two volumes are shared between services:

- `traces` (`/data/traces`): the worker writes trace files, and the API serves them at `/trials/:id/trace`.
- `sandboxes` (`/sandboxes`): trial sandboxes are created under `TMPDIR=/sandboxes`. The Hermes worker reads and writes the same directories, by the same absolute path, because the trial contract passes that path.

**Open the UI** at http://localhost:5173. The API is at http://localhost:3000. Stop the stack with `docker compose down`. To start from an empty database, use `docker compose down -v`, which also removes the volumes.

**If you already run the API on the host** (`npm run dev:api`, port 3000) or the Postgres container from Phase 6: stop the host API first, or set `API_HOST_PORT` to another port. Compose names the project after the directory, so in this checkout the `db` and `redis` containers from Phase 6 are reused when their settings match.

### 13.4 Checkpoint 13: a clean clone starts with one command and one `.env`

A clean clone has to come from git, so the checkpoint has to be run from a commit. Before the commit exists, the same test runs on a copy of the tree with only the files that would be committed (tracked files plus untracked files that are not ignored):

```bash
rm -rf /tmp/agent-evals-clean && mkdir -p /tmp/agent-evals-clean
git ls-files -co --exclude-standard -z | rsync -a --from0 --files-from=- ./ /tmp/agent-evals-clean/
cp .env /tmp/agent-evals-clean/.env           # the one file the clone needs
# This run also appended the host-port lines from .env.example to that copy (for example WEB_HOST_PORT=5174),
# because the dev stack already holds 3000, 5433, and 6379. A fresh clone needs none of them.
cd /tmp/agent-evals-clean && docker compose up --build -d
```

Recorded for this phase (fresh copy, empty volumes, `.env` copied, host ports moved to avoid the dev stack):

| Step | Result |
|---|---|
| `docker compose up --build -d` from empty volumes | All images build. `db`, `redis`, `api`, and `python-worker` report healthy. `web` and `worker` run (neither has a health check). `seed` exits 0 with `created: 21, unchanged: 0` |
| `GET /` on the API, `GET /health` on the Python worker | `Hello World!` and `{"ok":true,"worker":"python"}` |
| The web app through nginx | `/` and the route `/experiments` both return 200. `/api/tasks` returns 21 tasks |
| Experiment 1: 3 tasks × `gpt-4.1-mini` and `claude-haiku-4.5`, 1 trial each | `completed`, 6 trials. All 6 passed. The JSON export lists both configs with their models. The CSV has 6 rows, and each row names its model |
| Experiment 2: `mem_recall_client_01` on the `hermes` harness (memory on, `gpt-4.1-mini`) | `completed`. Passed, 2 steps, 4744 tokens. The trace has `memory_read` |
| Trace through the API | `GET /trials/:id/trace` returns the trace the worker wrote to the shared volume |
| `format=xml`, unknown id | 400 and 404 |
| Worker and Python logs after the runs | No error lines other than the Observe notice (§13.6) |

What this checkpoint shows: the one command starts every service, the tasks load without a manual step, both models run through the queue, and the export and trace endpoints work across the containers.

The checkpoint did not run in your dev checkout. There, `docker compose up --build` reuses your running `db` and `redis` containers and needs port 3000 free.

**Not checked here:** the browser drill from Phase 11 (clicking through the UI). Browser automation was not requested. The pages were checked through nginx with `curl`.

### 13.5 Bugs the checkpoint found, and what was changed

1. **The Python worker failed to start in the image.** `settings.py` took the repo root from `parents[4]` of its own path. That index exists in the source tree but not in the image, which puts the package under `/app/src`. The worker now computes the root from its own directory (`WORKER_DIR.parent.parent`), which is the same path on the host and in the image. In the image the root is `/`, where no `.env` exists. Compose passes the settings as environment variables instead.
2. **Hermes trials failed with `sandbox directory does not exist`.** The worker creates the trial sandbox in its own filesystem, and the Python worker checked for it in its own. The fix is the shared `sandboxes` volume at the same path in both services, with `TMPDIR` set on the worker (see 13.3).

### 13.6 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `env file .../.env not found` | The clone has no `.env` | `cp .env.example .env`, then set `OPENROUTER_API_KEY` |
| `Bind for 0.0.0.0:<port> failed: port is already allocated` | A host process or another container uses the port (for example 3000 for the API, or 5432 for a local Postgres) | Stop it, or set the matching `*_HOST_PORT` in `.env` |
| `404 ... no provider serves this model` | The model id has been retired on OpenRouter | Use a current id (`curl https://openrouter.ai/api/v1/models` lists them) |
| `402 ... can only afford N` | The key's credit cannot cover the requested output tokens | Lower `maxTokens`, or add credit to the key |
| `seed` shows `created: 0, unchanged: 21` | The tasks are already loaded | Expected. The seed is idempotent |
| `worker` logs `Observe is installed but sends nothing` | The app is not linked to NestJS Observe | Expected until `npx @nestjs/observe link` (AGENTS.md). It does not affect trials |
| The UI shows no tasks | `seed` did not run, or `api` is not healthy | `docker compose ps`, then `docker compose logs seed` |
| Hermes trial fails with `sandbox directory does not exist` | An older `docker-compose.yml` without the `sandboxes` volume | Use the current compose file, then `docker compose up -d` |
| Changed code does not show up | The image was built before the change | `docker compose up --build -d` |

### 13.7 Deviations from the plan

- **The second model** is `anthropic/claude-haiku-4.5`. The plan's example id is retired (§13.1).
- **The `worker` service** runs the API's own code (`apps/api/dist/worker.js`) and not the empty `workers/node-worker` package. That package is still unused. The API's existing `TRIAL_WORKER` switch makes the split possible.
- **The seeder is a service.** The plan had a manual step. The stack loads the tasks itself.
- **The UI runs in nginx** in the image, not in the Vite dev server. The dev proxy still works in dev mode.
- **Images are not pinned by digest.** Base images use tags (`node:24-alpine`, `python:3.12-slim`, `nginx:alpine`, `postgres:16`, `redis:7`). `uv` is pinned to the version used locally (0.13.9).
- **Containers run as root,** and `.env` values reach the containers as environment variables (visible with `docker inspect`). This is fine for a local stack, not for deployment.
- **The API still uses TypeORM `synchronize`** from the earlier phases. Migrations come later.

### 13.8 What this phase does not do

- **No cost.** `estimatedCostUsd` stays blank (§10.7).
- **No deployment.** There is no registry push, no TLS, and no secrets store.
- **No browser checks in this phase.** The UI drill from §11.5 is still to be run by hand.
- **The export is not paginated.** A large experiment returns everything in one response.

## Phase 14 — The memory experiment

### 14.0 What changed in this phase

- **`EXPERIMENT.md`** is the pre-registration: hypothesis, the one axis (`memory.enabled`), the task subset, the primary metric, the inspection rules, and the limitations. It was written before any main-run trial. Its amendments are dated.
- **`scripts/run-experiment.ts`** runs the experiment through the API. It creates the two configs and the experiment, starts it, polls until it finishes, and writes `compare.json`, `export.json` and `export.csv` under `results/<name>/`. The task groups and configs are fixed in the script, so the subset cannot drift between runs.

### 14.1 Run it

```bash
# Print the plan. Sends nothing.
npx tsx scripts/run-experiment.ts --dry-run

# Main run (100 trials). Needs OpenRouter credit. Set TRIAL_CONCURRENCY=1 in .env first.
npx tsx scripts/run-experiment.ts --name memory-ab --n 10 --configs mem-off,mem-on --tasks memory,control

# Re-collect results from an existing experiment. Starts no trials.
npx tsx scripts/run-experiment.ts --resume <experimentId>

# The labelled post-hoc v2: give both arms the write_file tool (default: no tools).
npx tsx scripts/run-experiment.ts --name memory-ab-v2-write-file --tools write_file
```

`API_URL` picks the API (default `http://localhost:3000`). The comparison is always `a = mem-on`, `b = mem-off`, so a positive delta means memory helped.

### 14.2 The pilot

A smoke run (`memory-ab-pilot`, 4 trials, both memory tasks, one per arm) checked the toggle and the pipeline. The memory-on trace shows the `memory_read` call returning the stored value, and the memory-off trace has no memory tool. The pilot also found an operational problem: two concurrent trials hit OpenRouter's in-flight budget check on a nearly empty balance, and one trial was rejected with a 402 before it reached the model. The compare endpoint excludes that trial, so the run now requires a sequential worker and a complete set of trials (EXPERIMENT.md, Amendments 1 and 2).

### 14.3 Status

Two runs, both 100 trials, all `succeeded`. Both are in `EXPERIMENT.md`.

- **v1, the pre-registered run** (no file tool): macro Δ 0.0 pts, CI [−60, +60], verdict `likely_noise`. Memory helps on `mem_recall_client_01` (10/10 against 0/10). It hurts on the control `det_weekday_01` (0/10 against 10/10): the model searched memory for a computable answer and ran out of budget. `mem_deploy_file_01` cannot pass in either arm, because the pre-registered config left out `write_file`. That was a mistake in the pre-registration, not a finding about memory.
- **v2, post-hoc** (`write_file` in both arms, labelled as post-hoc): macro Δ +60 pts, CI [+20, +100], verdict `a_better`. The memory tasks are 10/10 against 0/10 on both. But the win is mostly a control floor in the no-memory arm (`det_add_01`, 0/10): with `write_file` on, the model loops on file writes. The aggregate depends on the tool setting, so neither run settles the question alone.

The full results, trajectories and limitations are in `EXPERIMENT.md`.

### 14.4 What this phase does not do

- **No statistical power claim.** Two memory tasks and N = 10 give a wide interval. Expect a `likely_noise` verdict, and report it as such.
- **No retry of infrastructure failures.** A failed trial stays failed. The experiment is re-run, not patched (EXPERIMENT.md, Amendment 1).
