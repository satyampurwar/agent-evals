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

`docker-compose.yml`:

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
- No tools and no sandbox isolation beyond a fresh temp directory. Both come in Phase 4.
- No database. Results are written to disk only. Phase 6 adds persistence.
