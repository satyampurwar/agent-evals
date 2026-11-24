# Build log

Ordered build steps for **agent-evals**. Setup and how-tos: [README.md](README.md). Assignment write-ups: [deliverables/](deliverables/). This file does **not** record experiment outcomes; those live only under `deliverables/` and `results/`.

---

## Phase 1 — Scaffold

- npm workspaces root (`apps/*`, `packages/*`)
- NestJS API (`apps/api`) and Vue 3 + Vite UI (`apps/web`)
- Python worker skeleton with `uv` (`workers/python-worker`)
- `docker-compose.yml` stubs for Postgres, Redis, api, worker, web
- `.env.example`, `.gitignore`, `.dockerignore`

## Phase 2 — Domain schemas

- Package `@agent-evals/domain`: Zod schemas for Task, Config, Experiment, Trial, TraceEvent, graders, pricing
- Content-hash helpers later used by API persistence
- Unit tests for schema parse / reject paths

## Phase 3 — First offline trial path

- Packages: `trace`, `adapters-model` (mock / scripted), `adapters-harness` (baseline stub), `graders` (`exact_match`)
- CLI `scripts/run-one-trial.ts` runs one scripted trial end-to-end without an API key
- Checkpoint: addition task PASS / FAIL against expected answer

## Phase 4 — Tools and sandbox isolation

- Package `@agent-evals/sandbox`: per-trial temp dirs, path safety, setup file materialization
- Harness tools: `read_file`, `write_file`, `list_dir` (and related)
- Graders: `state_check`
- Isolation demo script; state-check task through the CLI

## Phase 5 — Live model (OpenRouter)

- `OpenRouterAdapter` in `adapters-model`; registry wiring
- Env loading for `OPENROUTER_API_KEY`
- Smoke CLI against a real model; live exact-match task runs

## Phase 6 — Persistence (NestJS + Postgres)

- TypeORM entities: task, config, experiment, trial
- Modules: tasks import/list, configs (immutable + content hash), experiments create/start skeleton
- `load-env` from repo-root `.env`
- Compose services for `db` and `redis`; API boots against them

## Phase 7 — Job queue and N trials

- Package `@agent-evals/runner`: `runTrial()` (sandbox → harness → grade → cleanup)
- BullMQ trials queue; `TrialProcessor` / `TrialExecutor`
- Separate Compose `worker` process (`TRIAL_WORKER` split from API HTTP)
- Trace store under `TRACE_DIR`; trial inspect API
- Retries for infra failures; scored failures stay scored

## Phase 8 — Task catalog (≥20)

- 21 tasks under `tasks/` + `tasks/manifest.json` at this phase (22 since Phase 18)
- Graders: `unit_test`; discriminating memory / skill tasks with setup fixtures
- `scripts/seed-tasks.ts`, `scripts/validate-task-set.ts`
- Compose `seed` service loads the catalog once

## Phase 9 — LLM judge

- Grader `llm_judge` + rubric registry
- Human-label fixtures under `fixtures/judge-human-labels/`
- `scripts/validate-judge.ts` (agreement / κ gate)
- Artifact: `judge-validation.txt` (not experiment results)

## Phase 10 — Statistics and compare

- Package `@agent-evals/stats`: macro pass rate, paired bootstrap, exact McNemar, per-task deltas, verdict / noise
- API `GET /experiments/:id/compare`
- Fixtures under `fixtures/stats/` for offline checks

## Phase 11 — Vue UI

- Routes: tasks, configs, experiments, experiment detail, compare, trial inspector
- Configs form: harness dropdown (`baseline` | `hermes` | `claude-agent`), model dropdown (`MODEL_IDS` from priced models)
- API client + formatting helpers; CSV export; trial trace timeline

## Phase 12 — Hermes harness

- FastAPI `workers/python-worker` runs Hermes Agent for one trial
- `HermesHarness` client in `adapters-harness`; shared `/sandboxes` volume with Node worker
- Health checks; Hermes-home volume for worker state

## Phase 13 — Full Docker stack and export

- One-command stack: `db`, `redis`, `api`, `worker`, `python-worker`, `seed`, `web`
- `Dockerfile.node`, web nginx image, `prices.json` in the image
- Experiment export JSON/CSV; OpenRouter multi-model via prices table

## Phase 14 — Experiment runner CLI

- `scripts/run-experiment.ts`: create configs → experiment → start → poll → write `results/<experimentId>/`
- Defaults: `--name full-catalog`, `--n 3`, `--tasks all`, file tools + `csv_summary`
- Flags: `--dry-run`, `--resume`, `--tools`, `--skills`, `--configs`, `--api`
- Outcomes are written up in `deliverables/EXPERIMENT.md`; exports go to `results/` (gitignored), not this log

## Phase 15 — Deliverable docs and cost metering

- Docs under `deliverables/`: DESIGN, LIMITS, COST, EXPERIMENT, video
- Root README: setup, add task / harness / model, code map, sample experiment
- List-price cost on trials (agent + judge × `prices.json`); compare / UI surfaces

## Phase 16 — Platform gap closure

- `metrics.stoppedReason`, judge token fields; export + Trial / Experiment UI
- Reject `persistAcrossTrials: true` at the schema
- `GET /experiments/:id/failures` + `packages/stats/failures.ts`
- CI: `.github/workflows/ci.yml` (validate-task-set, `npm test`, Python pytest)
- Compose: bind-mount `./data/traces` → `/data/traces` (gitignored)

## Phase 17 — Claude Agent SDK harness

- `claude-agent` harness in `packages/adapters-harness/src/claude-agent.ts`, wrapping `@anthropic-ai/claude-agent-sdk`; the SDK owns the loop and its messages map to trace events
- Budgets: `maxSteps` → SDK `maxTurns`, `timeoutMs` → abort timer, `maxTokens` checked after each model call
- Routed through OpenRouter (`0af1ca6`); spec `claude-agent.spec.ts`; registered in `registry.ts` and `HARNESS_IDS`
- Known limit (Anthropic models only) recorded in `deliverables/LIMITS.md`

## Phase 18 — Catalog and model additions

- Task `tasks/deterministic/13_unit_chunk.json` added (`6f0e7ed`); catalog is now 22 tasks: 13 deterministic, 5 LLM-judged, 4 discriminating
- Model `openai/gpt-6.1-terra` added to `prices.json` and `MODEL_IDS` (`993e0f5`)
- `scripts/run-experiment.ts` default plan updated to the 22-task catalog (`bd3f395`)
- Committed `results/full-catalog/` removed from the tree (`6f0e7ed`); the copy remains in history at `e7081c0`

## Phase 19 — Results written to disk

- `ExperimentResultsWriter` (`apps/api/src/execution/experiment-results.writer.ts`): when an experiment finishes, the worker writes `results/<experimentId>/` with `export.json`, `export.csv`, and `compare.json` for two-config experiments (`3b4da50`)
- Opt-in via `RESULTS_DIR`; the worker bind-mounts `./results`; writes are atomic and failures are logged, never fatal to the trial
- `scripts/run-experiment.ts` writes the same folder, keyed by experiment ID, with `mem-on` listed first so config A is memory on
- Six writer tests in `experiment-results.writer.spec.ts`

## Phase 20 — Documentation refresh

- README: container and queue inspection, database queries, two-way task-flow diagram, Skills section, "Sample experiment" and judge validation sections (`0c4e953`, `9029ca5`, `1efca5b`)
- `deliverables/` (DESIGN, LIMITS, COST, EXPERIMENT) brought up to date for the 22-task catalog, the Claude Agent SDK harness, results files and skill expansion
- Links to the removed `results/full-catalog/` replaced with a git-history reference; the COST plan (caching, early stopping, per-task N) is marked as not implemented

## Phase 21 — Web UI refinements

- Experiment form: "Select all" control for tasks, with an indeterminate state for partial selection (`57675a3`)
- Experiment detail: trial table shows a Trial column (first 8 characters of the id, full id on hover) (`de6ce87`)
- Configs page: form stacked above a scrollable saved-configs table; skill copy says Hermes receives tool names, not skill ids (`de6ce87`)

---

## Layout

```
agent-evals/
├── README.md
├── BUILD_LOG.md
├── deliverables/          DESIGN · LIMITS · COST · EXPERIMENT · video
├── apps/api · apps/web
├── packages/*            domain · trace · sandbox · adapters-* · graders · runner · stats
├── workers/python-worker
├── tasks/ · fixtures/ · scripts/
├── prices.json · judge-validation.txt
├── docker-compose.yml · Dockerfile.node · .env.example
├── results/              experiment exports from the worker and CLI (gitignored)
└── data/traces/          local bind-mount (gitignored)
```

**Verify:** `npm ci && npm test` and `(cd workers/python-worker && uv sync && uv run pytest -q)`. **Run:** `docker compose up --build` (see README).
