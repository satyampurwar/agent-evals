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

Each trial pins the task version and config `contentHash` it was created with, and gets a deterministic `seed`. Nothing executes the trials yet. They stay `queued` until the worker phase. That is why the trace endpoint returns 404 for now:

```bash
TID=$(curl -s "http://localhost:3000/trials?experimentId=$EID" | jq -r '.[0].id')
curl -s -o /dev/null -w "trace: HTTP %{http_code}\n" http://localhost:3000/trials/$TID/trace
```

Expected: `trace: HTTP 404`, with a message that the trace has not been recorded yet.

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

- Trials are queued, not run. Execution is Phase 7. An experiment shows `running` while its trials are `queued`.
- No migrations yet. `synchronize` creates the tables for local development only.
- No authentication, pagination, or Redis use yet.
- The seed script needs the API running. It does not write to the database directly.
- `npm audit` reports 8 advisories from the new dependency tree. Not addressed in this phase.
