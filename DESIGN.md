# Design

Agent Evals is a platform for comparing two agent configurations on the same tasks. A config is immutable data (harness, model, memory, tools, budgets) identified by a content hash. An experiment runs N trials of each config on each task, grades every trial, and compares the configs with a paired bootstrap confidence interval, a per-task breakdown, and an exact McNemar test.

Companion documents: [EXPERIMENT.md](EXPERIMENT.md) (the memory A/B, pre-registered and then run), [LIMITS.md](LIMITS.md) (what the results cannot support), [COST.md](COST.md) (how cost is estimated and what was spent), [README.md](README.md) (setup and how-to).

## 1. Architecture

```
            ┌──────────────┐   HTTP    ┌──────────────────────────┐
  Browser → │ web (Vue 3)  │ ────────▶ │ api (NestJS)             │
            └──────────────┘           │  tasks, configs,         │
                                       │  experiments, trials,    │
                                       │  compare, export         │
                                       └───────┬─────────┬────────┘
                                   enqueue     │         │ read/write
                                               ▼         ▼
                                    ┌─────────────┐  ┌──────────────┐
                                    │ Redis       │  │ Postgres     │
                                    │ BullMQ      │  │ tasks,       │
                                    │ trials queue│  │ configs,     │
                                    └──────┬──────┘  │ experiments, │
                                           │         │ trials       │
                                           ▼         └──────────────┘
                                 ┌───────────────────┐        ▲
                                 │ worker (node)     │────────┘ trial row +
                                 │ TrialExecutor     │          trace (JSON file)
                                 │  → runTrial()     │
                                 └──┬────────────┬───┘
                     HarnessAdapter │            │ ModelAdapter
                                    ▼            ▼
                     ┌──────────────────┐   ┌─────────────────┐
                     │ baseline (TS)    │   │ OpenRouter      │
                     │ hermes → worker  │   │ (or mock)       │
                     │ (python, FastAPI)│   └─────────────────┘
                     └──────────────────┘
```

| Component | Responsibility |
|---|---|
| `apps/api` | HTTP API, persistence (TypeORM), queue producer. `TRIAL_WORKER=off` in the API container. |
| `apps/api` worker | Consumes the trials queue. `TrialExecutor` creates the sandbox, runs the trial, writes the trace and the trial row in one transaction, and rolls the experiment status up. |
| `apps/web` | Pages for tasks, configs, experiments, compare, and the trial inspector. Calls the API only. |
| `packages/domain` | Zod schemas and types (Task, Config, Experiment, Trial, TraceEvent, PriceTable) and `costUsd`. No I/O. |
| `packages/runner` | `runTrial`: one trial from sandbox to graded result. Enforces the timeout and the infra-versus-scored split. Imports no harness or provider. |
| `packages/adapters-harness` | `HarnessAdapter` interface, the baseline TypeScript loop, the Hermes client, and the registry. |
| `packages/adapters-model` | `ModelAdapter` interface, OpenRouter and mock adapters, the registry, and `parseModelSpec`. |
| `packages/graders` | `exact_match`, `state_check`, `unit_test`, `llm_judge`, and the rubric registry. |
| `packages/sandbox` | Per-trial directories and path-safe file operations. |
| `packages/trace` | Trace writer and reader. |
| `packages/stats` | Macro pass rate, paired bootstrap, exact McNemar, per-task deltas, verdict. Pure functions over trial summaries. |
| `workers/python-worker` | FastAPI service that runs Hermes Agent (0.19.0) for one trial at a time. |

Dependency direction: `domain` ← everything. `runner` receives a `HarnessAdapter` as an argument, and it builds the model adapter through the model registry (`createModelAdapter`). It names no concrete harness, so adding a harness does not touch the runner. The API and worker compose the pieces. Adding a harness or model is described in §2 and §3.

## 2. Harness adapter

```ts
interface HarnessAdapter {
  readonly id: string;
  readonly displayName: string;
  run(input: HarnessRunInput): Promise<HarnessRunOutput>;
}

interface HarnessRunInput {
  task: Task;
  model: ModelAdapter;          // the baseline harness calls the model through this
  modelId: string;
  modelParams: { temperature: number; topP?: number };
  context: TrialContext;        // trialId, seed, sandboxDir, budgets, memory, skillIds, toolIds, emit()
}

interface HarnessRunOutput {
  finalAnswer: string;
  stoppedReason: 'completed' | 'max_steps' | 'max_tokens' | 'timeout' | 'error';
  usage: { promptTokens: number; completionTokens: number };
  stepCount: number;
}
```

The harness must emit every step through `context.emit`, and must stop when its budgets (`maxSteps`, `maxTokens`, `timeoutMs`) run out. It must use only the sandbox directory and the tools in `toolIds`.

**Two harnesses ship:**

- `baseline`: a TypeScript tool-calling loop. It calls the model through `ModelAdapter`, so its token usage is metered the same way as any other call.
- `hermes`: [Hermes Agent](https://github.com/NousResearch) running in the Python worker. `HermesHarness` posts one trial to the worker (`POST /run-trial`) and turns the reply into trace events. Hermes makes its own model calls, so the worker reports its usage. The worker's contract is in `workers/python-worker/README.md` and `contract.py`.

**To add a harness:**

1. Create `packages/adapters-harness/src/<id>.ts` with a class that implements `HarnessAdapter`. Emit trace events through `context.emit`, honour the three budgets, and return a `HarnessRunOutput`.
2. Register it in `packages/adapters-harness/src/registry.ts`: add the id to `HARNESS_IDS` and a `case` to `createHarness`.
3. Add a spec next to it. A config selects the harness with `harness.id`; no other code changes.

If the harness needs a separate runtime (as Hermes does), put a service behind an HTTP contract and keep the adapter as a thin client.

## 3. Model adapter

```ts
interface ModelAdapter {
  readonly id: string;
  complete(modelId: string, req: ModelRequest): Promise<ModelResponse>;
}

interface ModelRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature: number;
  maxTokens: number;
  stop?: string[];
  responseFormat?: 'json';      // the judge asks for a JSON object
}

interface ModelResponse {
  message: ChatMessage;         // may carry toolCalls
  usage: { promptTokens: number; completionTokens: number };
  raw?: unknown;
}
```

The config names the model as `{ provider, modelId, temperature }`. The provider string picks the adapter (`parseModelSpec("openrouter:openai/gpt-4.1-mini")`). `OpenRouterAdapter` covers every model OpenRouter serves through its `modelId`, so a new model on an existing provider needs no code, only a price.

**To add a model:**

1. For a new **model** on OpenRouter: add a `prices.json` entry (`inputPerMTok`, `outputPerMTok`). Nothing else. A config can use it immediately.
2. For a new **provider**: create `packages/adapters-model/src/<provider>.ts` implementing `ModelAdapter`, add a `case` to `createModelAdapter` in `registry.ts`, read its key from the environment, and add prices.
3. A model without a price is refused before the first call (`price_missing`).

## 4. Data model

| Entity | Key | Important columns |
|---|---|---|
| `tasks` | `(id, version)` | `name`, `contentHash`, `document` (jsonb: prompt, setup, graders, tags, `toolsAllowed`), `createdAt`. Re-importing the same content is a no-op. |
| `configs` | `id` (uuid), `contentHash` unique | `name`, `version` (int), `document` (jsonb). Identity is the hash of the canonical JSON (sorted keys). Names are labels. |
| `experiments` | `id` (uuid) | `name`, `hypothesis`, the planned matrix (tasks × configs × N), `status` (`pending`, `running`, `completed`, `partial`, `failed`), timestamps. |
| `trials` | `id` (uuid); unique on `(experimentId, taskId, configId, trialIndex)` | `taskVersion`, `configContentHash`, `seed`, `status` (`queued`, `running`, `succeeded`, `failed`, `timeout`, `cancelled`), `score`, `passed`, `metrics` (jsonb: latency, steps, prompt/completion/total tokens, `estimatedCostUsd`), `grade` (jsonb: per-grader results and reasoning), `error` (jsonb: code, retryable), `traceUri`. |

Traces are JSON files (`TRACE_DIR/<experimentId>/<trialId>.json`), referenced by `traceUri`. Event types are a closed set in the domain schema: `message`, `tool_call`, `tool_result`, `memory_read`, `memory_write`, `skill_invoke`, `step_boundary`, `error`. The Trial Inspector renders them in order.

The experiment's status is derived from its trials (`rollupExperimentStatus`, `experiment-status.ts`): `running` while any trial is queued or running; `failed` when every trial hit an infrastructure failure; `partial` when the trials finished but some failed, timed out, or were cancelled; `completed` when every trial was scored, pass or fail. An agent's scored failure does not make an experiment `partial`.

Trials and their traces are written in one transaction, so a trial row never points at a missing trace.

## 5. Isolation and reproducibility

- **Per-trial sandbox.** `createSandbox(trialId)` makes a fresh directory under `TMPDIR`. Tools and graders resolve paths inside it. Absolute paths, `..` escapes, and symlinks that leave the directory are refused (`packages/sandbox`, tests in `sandbox.spec.ts`).
- **Per-trial memory.** Memory starts from `task.setup.memory` for each trial. `persistAcrossTrials` is stored but not implemented, so no trial sees another trial's writes (LIMITS.md §4).
- **Hermes.** `HERMES_HOME` is pinned per worker process, not `~/.hermes`. Hermes's own memory store is off, and the trial's toolset is exactly `toolIds`.
- **Deterministic seed per trial.** `seed = first 8 hex digits of sha256("experimentId|taskId|configId|trialIndex") >>> 1` (`expand-matrix.ts`), passed to the harness and recorded on the trial. The seed does not make the model deterministic, but it makes the request reproducible from the record.
- **Immutable configs.** A config is never edited. A changed config is a new row with a new hash. Each trial stores the hash it ran with.
- **Idempotent trials.** The executor records an outcome once. A re-delivered job finds the trial finished and skips it.
- **Infra versus scored.** A runner error (`model_error`, `setup_error`) is a failure of the platform, not of the agent. It is retried (BullMQ, 3 attempts with exponential backoff) and, if it persists, recorded as `failed`. Scored failures are recorded as scored. Compare excludes infra failures from the verdict and reports them.
- **Concurrency.** `TRIAL_CONCURRENCY` (default 2) sets the parallel trials per worker. The provider's in-flight budget check can reject concurrent requests on a small balance; the Phase 14 runs used `TRIAL_CONCURRENCY=1` (EXPERIMENT.md, Amendment 2).

## 6. Graders and judge validation

### Graders

| Grader | Scores | Tasks (21) |
|---|---|---:|
| `exact_match` | Normalized equality with the expected string | 8 |
| `state_check` | A JSON or file value in the sandbox after the run | 5 |
| `unit_test` | Exit code of a command run in the sandbox against the agent's file | 3 |
| `llm_judge` | Rubric criteria scored 0–1 by a judge model | 5 |

Aggregation is `all_must_pass`: a trial passes when every grader passes. Each grader returns a score, a pass flag, and reasoning, and all of them are stored on the trial.

**Judge.** Temperature 0, JSON-object output, one retry on a malformed reply, a fixed judge model that differs from the agent (`google/gemini-2.5-flash` for the five judged tasks, agent `openai/gpt-4.1-mini`). The rubrics are versioned (`summary_v1`, and so on) and live in `packages/graders/src/rubrics.ts`.

### Judge validation (`judge-validation.txt`)

Labels: 25 human-labelled answers (5 per judged task, 9 pass and 16 fail, with borderline cases on purpose) in `fixtures/judge-human-labels`. `scripts/validate-judge.ts` runs the judge on each label and reports agreement and κ. The script exits 0 only when κ ≥ 0.6 and every label was judged.

| Measure | Result |
|---|---|
| Agreement | 92.0% (23/25) |
| Cohen's κ | 0.826 |
| Confusion (rows human, columns judge) | pass/pass 8, pass/fail 1, fail/pass 1, fail/fail 15 |
| Per task (agreement, κ) | `bugreport` 100%, 1.00; `email` 80%, 0.55; `explain` 100%, 1.00; `summary` 100%, 1.00; `tradeoff` 80%, 0.62 |
| Judge errors | 0 |

The two disagreements are kept, and the rubric was not edited to fit them. The labels were written by one person, so there is no inter-rater check. These figures show the judge agrees with these labels; they do not show it is calibrated on other answers (LIMITS.md §2).

## 7. Statistics and choice of N

### Method (`packages/stats`)

Two configs A and B are compared on the tasks they share.

1. **Macro pass rate** per config: the mean over common tasks of each task's pass rate. Each task counts once, so a task with many trials does not dominate.
2. **Delta** = macro(A) − macro(B). Its interval is a **paired bootstrap over tasks**: resample the common tasks with replacement (5,000 resamples, seed 1, α = 0.05), recompute the delta on each resample, take the 2.5% and 97.5% quantiles. The unit is the task, because trials of one task are not independent.
3. **McNemar** (exact, two-sided binomial on the discordant pairs), on the pairs `(task, trialIndex)` that both configs scored. Its p-value treats trials as independent, so it is optimistic when trials cluster by task. The verdict does not use it.
4. **Verdict.** If the interval contains 0: `likely_noise`. Otherwise `a_better` (delta > 0) or `b_better`. With fewer than two common tasks that have scored trials on both sides: `insufficient_data`, and no interval is computed.
5. **Per-task deltas** are reported for every task, unadjusted. They are exploratory (§5 below and LIMITS.md §5).
6. **Non-verdict trials** (infra failures, no answer) are counted and listed, never scored as wrong.

Costs, latency, and token totals are reported as means beside the quality numbers.

### How N was chosen

For a per-task comparison with N trials per arm and pass rates near 0.5 (the worst case), the standard error of the difference is √(2 × 0.25 / N). At 80% power and α = 0.05, the minimum detectable difference is about 2.8 × that error:

| N per arm | Standard error | Minimum detectable difference (one task) |
|---:|---:|---:|
| 3 | 0.41 | 114 points |
| 5 | 0.32 | 89 points |
| **10** | **0.22** | **63 points** |
| 20 | 0.16 | 44 points |
| 30 | 0.13 | 36 points |

N = 10 was chosen because it is the smallest N at which a large per-task effect (about 60 points) can be detected. N = 3 cannot detect even a full pass-to-fail swing reliably. Going to N = 30 would cut the threshold to 36 points for 3× the trials. The memory experiment ran 100 trials per arm pair, about $0.13 at list price. The full 21-task catalog at N = 10 is 420 trials, about $0.8 at list price (COST.md §7).

The interval is driven by the number of tasks, not only by N. With 5 tasks, the v1 interval was ±60 points (EXPERIMENT.md). N = 10 does not fix that. More tasks would.

## 8. Assumptions

These are the assignment's assumptions (implementation.md §2) and how the repo honours each:

1. **Primary metric** is a pass/fail per trial. Soft scores are kept in `grade` but are not the verdict.
2. **Trial independence.** Each trial gets a fresh sandbox and empty memory, unless `persistAcrossTrials` is set (not implemented; LIMITS.md §4).
3. **Non-determinism.** `temperature` 0 is not treated as determinism. The showcase used N = 10 per arm.
4. **Sandbox.** A per-trial temporary directory on the host, not a container (LIMITS.md §6).
5. **Hermes** is used as published, in its own worker. Mismatches with its API are handled in the worker and the adapter, not in the core.
6. **Judge model** is fixed and differs from the agent model (§6).
7. **Cost accounting** uses list prices recorded with a date in `prices.json` (`asOf`). Provider cache discounts are not modelled (COST.md §4).
8. **Scope.** Failure analysis and distributed workers are out of scope. One queue and one worker process are enough for this workload.
9. **OpenRouter** is the single model interface for the hosted models.
10. **Judge calibration.** 25 labels show the method. They do not show the judge is calibrated.

## 9. Pointers

- [EXPERIMENT.md](EXPERIMENT.md): pre-registration, pilot, amendments, both runs with CIs, three trajectories, conclusion.
- [LIMITS.md](LIMITS.md): what the results and the platform cannot support.
- [COST.md](COST.md): cost formula, hand check against the stored data, actual spend, and reduction strategies.
- [README.md](README.md): setup, `.env`, `docker compose up`, how to add a task, harness, or model, how to run and export.
