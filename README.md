# agent-evals

Platform for comparing agent configs (harness × model × settings) on a shared task set: N trials per cell, sandboxed runs, deterministic and LLM graders, bootstrap/McNemar compare, full traces, JSON/CSV export.

Harnesses: `baseline` (TypeScript tool loop) and `hermes` (Python worker). Models go through OpenRouter (or your own adapter).

---

## Setup

**Prerequisites:** Docker with Compose, an OpenRouter API key with credit. For host-side tests/scripts: Node.js 24, `uv`, Python 3.12+.

```bash
cp .env.example .env
# set OPENROUTER_API_KEY=...

docker compose up --build
```

- Web UI: http://localhost:5173  
- API: http://localhost:3000  
- `seed` loads the 21-task catalog once and exits.

Useful `.env` knobs: `TRIAL_CONCURRENCY=1` on a small balance; `*_HOST_PORT` if a port is taken; `PRICE_TABLE_PATH` for a custom price table. `.env` is never committed.

### Fresh run / reset

Wipe DB and sandboxes (Compose volumes), then start clean. Tasks are reseeded; host `results/` and `data/traces/` are left alone (traces are bind-mounted from `./data/traces`, gitignored).

```bash
docker compose down -v
docker compose up --build -d
```

Optional: clear host-side artifacts only (does not clear Postgres):

```bash
rm -rf data/traces/*    # trial traces (Docker and host both write here)
rm -rf results/*        # CLI exports; skip if you still need demo/experiment artifacts
```

Do not delete `tasks/`, `fixtures/`, `prices.json`, or `.env`.

---

## Add a task

1. Write `tasks/<group>/<name>.json` using `TaskSchema` in [`packages/domain/src/schemas.ts`](packages/domain/src/schemas.ts) (`id`, `version`, `name`, `description`, `prompt`, `graders`, `tags`; optional `setup`, `toolsAllowed`, `expectedDiscriminators`). Copy a peer task and edit.
2. Add the path to [`tasks/manifest.json`](tasks/manifest.json).
3. Validate: `npx tsx scripts/validate-task-set.ts` (min 20 tasks, grader coverage, rubrics, priced judge models).
4. Load: `npm run seed:tasks` (or `docker compose up seed`).

---

## Add a harness

1. Implement `HarnessAdapter` in `packages/adapters-harness/src/<id>.ts`: `run(input)` emits via `context.emit`, respects `maxSteps` / `maxTokens` / `timeoutMs`, returns `HarnessRunOutput`.
2. Register in [`packages/adapters-harness/src/registry.ts`](packages/adapters-harness/src/registry.ts): add the id to `HARNESS_IDS` and a `case` in `createHarness`.
3. Add a unit spec; create configs with `harness.id` set to the new id (Configs UI or `POST /configs`).

Interface details: [DESIGN.md](deliverables/DESIGN.md) §2.

---

## Add a model

- **OpenRouter model:** add a list price in [`prices.json`](prices.json):
  `"<provider>/<model>": { "inputPerMTok": …, "outputPerMTok": … }`.  
  Unpriced models fail trials before any call (`price_missing`).
- **Configs UI:** also add the id to `MODEL_IDS` in [`apps/web/src/lib/forms.ts`](apps/web/src/lib/forms.ts) so it appears in the model dropdown.
- **New provider:** implement `ModelAdapter` in `packages/adapters-model/src/<provider>.ts`, register in `createModelAdapter` ([`registry.ts`](packages/adapters-model/src/registry.ts)), and add prices.

Interface details: [DESIGN.md](deliverables/DESIGN.md) §3.

---

## Sample experiment

With the stack up (`docker compose up -d`) and `npm install` on the host:

```bash
npx tsx scripts/run-experiment.ts --dry-run
npx tsx scripts/run-experiment.ts --name full-catalog --n 3 --configs mem-off,mem-on --tasks all
```

Defaults are full catalog, N = 3, memory on vs off (Hermes). Writes `results/<name>/`. Analysis: [EXPERIMENT.md](deliverables/EXPERIMENT.md).

---

## More docs

| Doc | Contents |
|---|---|
| [DESIGN.md](deliverables/DESIGN.md) | Architecture, adapters, data model, isolation, graders, stats |
| [EXPERIMENT.md](deliverables/EXPERIMENT.md) | Memory on vs off experiment and results |
| [LIMITS.md](deliverables/LIMITS.md) | Known limits |
| [COST.md](deliverables/COST.md) | Cost formula and spend |
| [video.md](deliverables/video.md) | Demo video script and checklist |
| [BUILD_LOG.md](BUILD_LOG.md) | Ordered application build steps |

## Code map

| Path | Role |
|---|---|
| `apps/api` | Nest HTTP API + queue worker (`main.ts` / `worker.ts`); Postgres + BullMQ |
| `apps/web` | Vue 3 UI (tasks, configs, experiments, compare, trial inspector) |
| `packages/domain` | Shared Zod schemas and pricing helpers |
| `packages/runner` | `runTrial`: sandbox → harness → graders → cleanup |
| `packages/adapters-harness` | `baseline` + `hermes` client; tools / memory / skills |
| `packages/adapters-model` | OpenRouter (+ mock/scripted for tests) |
| `packages/graders` | exact_match, state_check, unit_test, llm_judge |
| `packages/stats` | Bootstrap, McNemar, compare, failure categories |
| `packages/sandbox` · `packages/trace` | Per-trial dirs; in-memory trace buffer |
| `workers/python-worker` | Hermes FastAPI worker (`POST /run-trial`) |
| `tasks/` · `fixtures/` · `scripts/` | Catalog, judge/stats fixtures, CLIs |
| `data/traces/` | Trial JSON traces (gitignored; Compose bind-mount) |

Module headers in each package/`src` file describe the local contract; start with [DESIGN.md](deliverables/DESIGN.md) for the system picture.

---

## Validate the LLM judge (human labels)

Where a task uses `llm_judge`, check that the judge is trustworthy against a small set of human-labelled examples before trusting experiment scores.

**Labels:** [`fixtures/judge-human-labels/`](fixtures/judge-human-labels/) — 25 answers (5 per judged task), each with `humanPassed` and notes. Rubrics and judge model come from the matching task under `tasks/judge/`.

**Run** (needs `OPENROUTER_API_KEY` in `.env`; calls the same `llmJudge()` path as trials):

```bash
npx tsx scripts/validate-judge.ts | tee judge-validation.txt
```

**What it prints:** agreement rate, Cohen’s κ, confusion matrix, per-task κ, and every disagreement with judge reasoning.

**Pass gate:** exit `0` only if κ ≥ 0.6 and every label was judged without setup errors; otherwise exit `1`.

**Last saved run** ([`judge-validation.txt`](judge-validation.txt)): 92% agreement (23/25), κ = 0.826. Limits of this check (one labeller, n = 25) are in [LIMITS.md](deliverables/LIMITS.md) §2 and [DESIGN.md](deliverables/DESIGN.md) §5.

**After changing a rubric, threshold, or judge model:** re-run the command above and commit the new `judge-validation.txt` if you want the artifact in the repo.
