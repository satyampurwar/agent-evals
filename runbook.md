# Runbook

How to run the whole application from an empty machine: build the stack, load the tasks, run an experiment, read the results, run the tests, and reset.

Two paths:

- **Path A, Docker (recommended).** One command starts everything. Use this to run or demo the app.
- **Path B, host processes.** Postgres and Redis in Docker, everything else on your machine. Use this to develop.

Every step lists what you should see. If you do not see it, go to [Troubleshooting](#8-troubleshooting).

## 1. Prerequisites

| Need | For | Notes |
|---|---|---|
| Docker with Compose v2 | Path A and B | `docker compose version` must work |
| OpenRouter API key with credit | Any trial that calls a model | About $1 covers everything below. See [cost](#7-what-it-costs) |
| Node.js 24, npm | Path B, tests, scripts | The images use `node:24-alpine` |
| `uv` and Python 3.12+ | Path B (Hermes worker), Python tests | Hermes needs Python `>=3.11,<3.14` |
| Free host ports | Path A | `3000` API, `5173` web, `5432` Postgres, `6379` Redis, `8001` Python worker |

If a port is taken, do not stop the other program. Move ours with the `*_HOST_PORT` variables in `.env` (§2).

The scripts under `scripts/` run on your machine, not in Docker, so they need `npm install` even on Path A.

## 2. Get the code and set `.env`

```bash
cd agent-evals
cp .env.example .env
```

Open `.env` and set the key:

```
OPENROUTER_API_KEY=sk-or-...
```

`.env` is never committed, and `.dockerignore` keeps it out of the images. Compose passes it to the services at run time.

Optional settings (all commented out or defaulted in `.env.example`):

| Variable | Default | When to set it |
|---|---|---|
| `TRIAL_CONCURRENCY` | `2` | Set to `1` on a small balance. OpenRouter rejects two concurrent requests whose reserved output tokens it cannot cover (`402 in_flight_budget_exhausted`). The Phase 14 experiments ran at `1` |
| `API_HOST_PORT`, `WEB_HOST_PORT`, `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `PYTHON_WORKER_HOST_PORT` | `3000`, `5173`, `5432`, `6379`, `8001` | A host port is already in use. Inside the stack the services keep their own ports, so nothing else changes |
| `PRICE_TABLE_PATH` | `prices.json` at the repo root (`/app/prices.json` in the image) | You keep prices in another file |

If you move `POSTGRES_HOST_PORT` and also run things on the host (Path B), change the port inside `DATABASE_URL` to match.

## 3. Path A: the full stack in Docker

### 3.1 Start

```bash
docker compose up --build -d
```

The first run downloads base images and builds three images, so it takes several minutes. Later runs reuse the layers.

| Service | Host port | Role |
|---|---|---|
| `db` | `5432` | Postgres 16 |
| `redis` | `6379` | Redis 7, the BullMQ queue |
| `api` | `3000` | NestJS API. Queues trials, runs none (`TRIAL_WORKER=off`) |
| `worker` | none | Consumes the queue and runs trials. Waits for `api` and `python-worker` to be healthy |
| `python-worker` | `8001` | Hermes Agent harness |
| `seed` | none | Loads the 21 tasks, then exits 0 |
| `web` | `5173` | The UI (nginx, `/api/` proxied to the API) |

### 3.2 Check it

```bash
docker compose ps
curl -s localhost:3000/                       # Hello World!
curl -s localhost:8001/health                 # {"ok":true,"worker":"python"}
curl -s localhost:3000/tasks | jq length      # 21
```

Expect `db`, `redis`, `api` and `python-worker` healthy, `web` and `worker` running, and `seed` exited with code 0 (`docker compose logs seed` shows `created: 21`). Open **http://localhost:5173**. The Tasks page lists 21 tasks.

The `worker` log shows `Observe is installed but sends nothing`. That is expected and harmless (LIMITS.md §15).

## 4. Run an experiment

Both ways need a couple of configs. A **config** is the thing under test (harness, model, memory, tools, budgets). Saving identical settings twice returns the existing config, so re-running these steps is safe.

### 4.1 With the script (the real experiment, one command)

This is the Phase 14 memory A/B: Hermes with memory off against on, same model, 5 tasks, 10 trials each.

```bash
npm install                                   # once; scripts run on the host
npx tsx scripts/run-experiment.ts --dry-run   # prints the plan, sends nothing
npx tsx scripts/run-experiment.ts --name memory-ab --n 10 --configs mem-off,mem-on --tasks memory,control
```

- It creates the two configs and the experiment, starts it, polls until it finishes, then writes `compare.json`, `export.json` and `export.csv` to `results/memory-ab/`.
- 100 trials. About **8 minutes** at `TRIAL_CONCURRENCY=1`. About **$0.13** at list price.
- The comparison is always `A = mem-on`, `B = mem-off`, so a positive delta means memory helped.
- To re-collect results from an experiment that already ran, with no new trials: `npx tsx scripts/run-experiment.ts --resume <experimentId>`.
- The post-hoc variant (labelled in EXPERIMENT.md) gives both arms `write_file`: `npx tsx scripts/run-experiment.ts --name memory-ab-v2-write-file --tools write_file`.
- If the API is not on port 3000: `API_URL=http://localhost:<port>` or `--api http://localhost:<port>`.

The script does not retry. If any trial ends in an infrastructure failure, the run is invalid and you run the whole experiment again (EXPERIMENT.md, Amendment 1).

### 4.2 By hand (UI and `curl`)

**Baseline configs in the UI.** On **Configs**, create a config. The form sets `harness.id` to `baseline` and lets you pick the model and temperature.

**Hermes configs need the API** (the form cannot create them):

```bash
A=http://localhost:3000
mk() {  # mk <name> <memoryEnabled>
  curl -s -X POST $A/configs -H 'content-type: application/json' -d "{
    \"name\": \"$1\",
    \"harness\": { \"id\": \"hermes\", \"settings\": {
      \"skillsEnabled\": [], \"tools\": [], \"maxSteps\": 6, \"maxTokens\": 8000, \"timeoutMs\": 120000,
      \"memory\": { \"enabled\": $2, \"persistAcrossTrials\": false } } },
    \"model\": { \"provider\": \"openrouter\", \"modelId\": \"openai/gpt-4.1-mini\", \"temperature\": 0 }
  }" | jq -r .id
}
OFF=$(mk mem-off false); ON=$(mk mem-on true)
echo "$OFF $ON"
```

**Create and start an experiment.** In the UI: **Experiments**, name it, pick tasks and configs, set trials per cell, **Create**, then **Start** on the experiment page. Creating does not start it. With `curl`:

```bash
EXP=$(curl -s -X POST $A/experiments -H 'content-type: application/json' -d "{
  \"name\": \"smoke\", \"hypothesis\": \"memory helps on recall tasks\",
  \"taskIds\": [\"det_add_01\", \"mem_recall_client_01\"],
  \"configIds\": [\"$OFF\", \"$ON\"], \"nTrials\": 3 }")
EID=$(echo "$EXP" | jq -r .id)
curl -s -X POST $A/experiments/$EID/start | jq -c '{status, queued}'    # 12 queued
curl -s $A/experiments/$EID/status | jq -c .                            # poll until completed
```

Start returns `202`. A second start returns `409`, so trials are never queued twice. The experiment status becomes `completed`, `partial` (some trials failed or timed out), or `failed` (all trials hit infrastructure failures).

### 4.3 A small run that shows cost

Trials recorded since Phase 15 carry `estimatedCostUsd`, and the Compare page shows the mean. Trials from older runs show a dash. For a cheap run that exercises the judge as well:

- Tasks: `det_add_01`, `mem_recall_client_01`, `judge_summary_01`. Configs: the two above. `nTrials`: 3. That is 18 trials, a few cents.
- A judged trial costs about $0.0007 (agent $0.00025 plus judge $0.00042).

## 5. Read the results

| Where | What you get |
|---|---|
| **Experiments** page | All experiments, newest first |
| **Experiment** page, `/experiments/:id` | Status and counts, refreshes every 3 s while running. **Export CSV**. **Compare configs** |
| **Compare**, `/experiments/:id/compare` | Pick A and B. Verdict (`a_better`, `b_better`, `likely_noise`, `insufficient_data`), macro pass rate per side, delta A − B with its 95% interval and McNemar p-value, the per-task table, mean latency, tokens and cost, and the counts of excluded trials |
| **Trial**, `/trials/:id` | Outcome, each grader's result and reasoning (the judge's text for `llm_judge` tasks), metrics, error, the agent's final answer, the trace as a timeline |

Over the API:

```bash
curl -s "$A/experiments/$EID/compare?a=$ON&b=$OFF" | jq .     # same data as the Compare page
curl -s "$A/experiments/$EID/export?format=json" -o exp.json  # experiment, configs, every trial
curl -s "$A/experiments/$EID/export?format=csv"  -o exp.csv   # one row per trial
curl -s "$A/trials?experimentId=$EID" | jq length             # trial list
curl -s "$A/trials/<trialId>/trace" | jq .                    # the full trace
```

How to read a result: the verdict uses the **interval** over tasks, not the p-value. The McNemar p-value treats trials as independent and is optimistic. A `likely_noise` verdict means this design cannot tell the arms apart, not that they are equal. With five tasks, expect wide intervals (DESIGN.md §7).

## 6. Path B: host processes (development)

```bash
docker compose up -d db redis                 # infrastructure only
npm install                                   # builds the packages (postinstall)
```

Run each of these in its own terminal and leave them running:

```bash
npm run start:dev -w @agent-evals/api         # API on :3000; runs the trial worker in the same process
npm run dev:worker:python                     # Hermes worker on :8001 (needs: cd workers/python-worker && uv sync --all-groups, once)
npm run dev -w @agent-evals/web               # UI on :5173; proxies /api to :3000
```

Then, in a fourth terminal:

```bash
npm run seed:tasks                            # first run: created 21
npx tsx scripts/validate-task-set.ts          # task set OK
```

Notes:

- The API process consumes the queue itself here. Do not also start the Compose `worker`.
- The Node side finds the Hermes worker at `HERMES_WORKER_URL` (default `http://127.0.0.1:8001`).
- After you edit anything under `packages/`, run `npm run build:packages`. The API and other packages import `dist/`.
- If `npm install` fails with `SELF_SIGNED_CERT_IN_CHAIN`: `NODE_OPTIONS=--use-system-ca npm install`. For `uv` behind a re-signing proxy: `UV_SYSTEM_CERTS=1 uv sync --all-groups`.
- Both paths use port 3000 by default. Stop one stack before you start the other, or move the ports.

### Tests and validators

```bash
npm test                                      # 10 TypeScript workspaces, 262 tests, no key and no network
npm run test:e2e -w @agent-evals/api          # API end to end. Needs Postgres and Redis up
(cd workers/python-worker && uv run pytest)   # 35 tests
npx tsx scripts/validate-task-set.ts          # task catalog rules, including judge prices
npx tsx scripts/validate-judge.ts | tee /tmp/judge.txt   # judge vs 25 human labels. About $0.011; needs the key
```

Write the judge output to `/tmp`, not to `judge-validation.txt`: that file is the saved artifact, and `tee` would overwrite it. Expected: 25 judged, agreement 92%, κ about 0.83, exit 0. Individual judge scores move a little between runs.

## 7. What it costs

| Action | Trials | List price | Time |
|---|---:|---:|---|
| Smoke (§4.2) | 12 | about $0.02 (the memory-on arm carries about 4,300 extra prompt tokens per trial) | a minute or two |
| Memory A/B, pre-registered (§4.1) | 100 | about $0.13 | about 8 minutes at concurrency 1 |
| Memory A/B v2 (`--tools write_file`) | 100 | about $0.26 | about 6 minutes |
| Judge validation | 25 judge calls | about $0.011 | a few minutes |
| One judged trial | 1 | about $0.0007 | seconds |

List price is what the platform stores as `estimatedCostUsd`. The provider billed about half of it in our runs because of prompt caching (COST.md §4). Add the 21-task catalog at N = 10 with two configs and you are at about $0.8 list price (COST.md §7).

A model that has no entry in `prices.json` fails its trials before any call, with `price_missing`. Add the entry first (README, "Add a model").

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `env file .../.env not found` | No `.env` | `cp .env.example .env`, set the key |
| `port is already allocated` or `address already in use` | Something else holds the port, often a local Postgres on 5432 or another API on 3000 | Set the matching `*_HOST_PORT` in `.env`, then `docker compose up -d`. With a moved Postgres port, fix `DATABASE_URL` too |
| `FATAL: role "evals" does not exist` | The API reached a different Postgres on 5432 | Same: move `POSTGRES_HOST_PORT`, update `DATABASE_URL` |
| UI shows no tasks | `seed` did not run or `api` is unhealthy | `docker compose ps`, `docker compose logs seed api` |
| `402 ... in_flight_budget_exhausted` | Concurrent trials reserve more output tokens than the balance covers | `TRIAL_CONCURRENCY=1` in `.env`, restart the `worker`, re-run the whole experiment |
| `402 ... can only afford N` | The balance cannot cover one request's output tokens | Add credit, or lower `maxTokens` in the config |
| `404 ... no provider serves this model` | OpenRouter retired the model id | Pick a current id from `https://openrouter.ai/api/v1/models`, add its price |
| Trial fails `price_missing` | The model has no entry in `prices.json` | Add `inputPerMTok` and `outputPerMTok`, rebuild the images (`docker compose up --build -d`) |
| Hermes trial fails with `sandbox directory does not exist` | The `worker` and `python-worker` do not share the `sandboxes` volume | Use the current `docker-compose.yml` and `docker compose up -d` |
| Hermes trial never answers, ends on a budget | Tool-first loops in Hermes (`write_file`, `memory_read`) | Known behaviour. It scores as a failure. See LIMITS.md §4 |
| Changed code does not show up in Docker | The image predates the change | `docker compose up --build -d` |
| Changed code does not show up on the host | `dist/` is stale | `npm run build:packages` |
| `POST /experiments/:id/start` returns HTTP 409 | The experiment was already started | Expected. Create a new experiment to run again |
| Compare cost is a dash | Those trials were recorded before Phase 15 | Expected. New trials carry a cost |

Logs: `docker compose logs -f worker python-worker api`. Trial traces are JSON files at `<experimentId>/<trialId>.json`. On Path B they are under `data/traces/` in the repo. In Docker they are in the `traces` volume, mounted at `/data/traces`, and you read them through `GET /trials/:id/trace`.

## 9. Stop and reset

```bash
docker compose down            # stop; keeps the database, traces and Hermes home
docker compose down -v         # stop and delete every volume: empty database, no traces, empty sandboxes
```

After `down -v`, `docker compose up --build -d` starts from nothing and `seed` reloads the tasks. Experiments and trials are gone, but `results/` on the host is untouched.

## 10. Order of a first-time run, as a checklist

1. `cp .env.example .env` and set `OPENROUTER_API_KEY`.
2. `docker compose up --build -d`.
3. `docker compose ps`, `curl localhost:3000/tasks | jq length` returns `21`, open http://localhost:5173.
4. `npm install`, then `npx tsx scripts/run-experiment.ts --dry-run`.
5. `npx tsx scripts/run-experiment.ts --name memory-ab --n 10 --configs mem-off,mem-on --tasks memory,control`.
6. Open the experiment in the UI, **Compare configs** with A = `mem-on`, B = `mem-off`.
7. Open a failed trial from the table.
8. `npm test`.

Other documents: [DESIGN.md](DESIGN.md), [EXPERIMENT.md](EXPERIMENT.md), [LIMITS.md](LIMITS.md), [COST.md](COST.md), [README.md](README.md).
