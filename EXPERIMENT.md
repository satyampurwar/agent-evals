# EXPERIMENT.md: memory on versus off, Hermes, same model

**Status:** pre-registered on 2026-11-21, before the main run. The main run was executed on 2026-11-21 (experiment `16da4716-6bd6-4a57-9adf-57f896874495`). See Results. The pre-registered text above is unchanged.

## Hypothesis

With the same model and the same harness (Hermes Agent, `openrouter:openai/gpt-4.1-mini`), turning on the trial's memory tools raises the pass rate on tasks that depend on memory. On tasks that need no memory, the pass rate does not change.

The one axis is `memory.enabled`. Everything else in the two configs is identical.

## Design

| Item | Value |
|---|---|
| Harness | `hermes` (Hermes Agent 0.19.0 through the Python worker) |
| Model | `openrouter:openai/gpt-4.1-mini`, temperature 0 |
| Config A, `mem-on` | `memory.enabled: true`, `persistAcrossTrials: false` |
| Config B, `mem-off` | `memory.enabled: false`, `persistAcrossTrials: false` |
| Shared settings | `tools: []`, `skillsEnabled: []`, `maxSteps: 6`, `maxTokens: 8000`, `timeoutMs: 120000` |
| N | 10 trials per task per config (100 trials in total). Seeds come from the platform (`seedFor`) |

### Task subset (fixed before the run)

| Group | Tasks | Why |
|---|---|---|
| `memory` | `mem_recall_client_01`, `mem_deploy_file_01` | The only two memory-tagged tasks in the catalog. Each seeds the trial's memory (`setup.memory`) and needs it to answer |
| `control` | `det_add_01`, `det_letter_count_01`, `det_weekday_01` | Exact-match tasks with no tools and no memory seed. Memory should not change them |

**Control rule (applied before the run):** exact-match, no tools, no memory seed, answerable in one reply.

**Known risk, recorded before the run:** under Hermes, `det_add_01` once looped on `write_file`/`read_file` and ran out of budget without answering (Phase 12, README §12.5). If both arms fail a control in the main run for that reason, the result is reported as a floor effect. The control is not dropped or swapped after the run.

## Primary metric and analysis

- **Primary:** the difference in macro pass rate, memory on minus memory off, over the five tasks. Source: `GET /experiments/:id/compare?a=<mem-on>&b=<mem-off>`. It comes with a paired bootstrap 95% interval over tasks and an exact McNemar p-value over paired trials.
- **Secondary, descriptive:** the same difference inside each group (from `perTask` in the compare output); total tokens and cost (usage multiplied by OpenRouter's list price); mean latency; the count of trials that stopped on `max_tokens`, `max_steps`, or `timeout`.
- **Decision rule:** the verdict is the one the compare endpoint gives (`noise` when the interval includes 0 or there is too little data). Report that verdict whatever it is. Do not re-analyze with a different metric or subset after the run.

## Inspection plan (fixed before the run)

Pick three trajectories from the export, using these rules:

1. **Memory-off failure:** the first `mem-off` trial on `mem_recall_client_01` (lowest `trialIndex`) that did not pass.
2. **Memory-on success on the same task:** the `mem-on` trial on `mem_recall_client_01` with the same `trialIndex` as (1), if it passed. Otherwise the first `mem-on` trial that passed.
3. **Control where both pass:** the first `det_*` task with a pass in both arms, on trial index 0.

For each, record the trial id, the stop reason, the grader line, and what the trace shows (`memory_read` and `memory_write` events, tool calls).

## Cost and limits

- The run needs OpenRouter credit on the account, not just the key cap (see Run status).
- Cost is estimated from the smoke run (Pilot below) and recorded again after the run.

## Limitations (stated before the run)

- **Two memory tasks.** The interval over tasks will be wide. Expect `noise`, and report that as the honest answer.
- **One model and one harness.** The result does not generalise to other models or to the baseline harness.
- **The Hermes system prompt is part of the treatment.** Its tool-first behaviour (Phase 12) can affect both arms. The comparison is memory on versus off *under Hermes*, not memory versus no harness.
- **Controls can floor.** See the known risk above.

## Pilot (smoke, not part of the result)

Planned as one trial per arm on `mem_recall_client_01`. Run as `--tasks memory --n 1`, so both memory tasks ran (4 trials). This is a small deviation from the plan, and it is noted here rather than hidden. The pilot was not used to tune the design.

Run: experiment `fb4c8202-bd22-4c36-9a26-5a86c78e5619` (name `memory-ab-pilot`), on a separate compose project (`p14`) with alternate ports. Output in `results/memory-ab-pilot/`.

| Task | Arm | Trial | Result | Tokens (prompt / completion) | Latency | Note |
|---|---|---|---|---|---|---|
| `mem_recall_client_01` | mem-on | 0 | pass | 4722 / 22 | 2356 ms | Trace: `memory_read` (query "client id") hit `client_id = HL-2044`; answered `HL-2044` |
| `mem_recall_client_01` | mem-off | 0 | fail | 383 / 8 | 3442 ms | No tool call; answered "No client ID found in memory." |
| `mem_deploy_file_01` | mem-off | 0 | fail | 444 / 26 | 1558 ms | One step, no `write_file`; `deploy.json` missing |
| `mem_deploy_file_01` | mem-on | 0 | **infra failure, excluded** | 0 / 0 | 417 ms | HTTP 402 `in_flight_budget_exhausted` from OpenRouter; the model was never called |

What the pilot shows:

- **The toggle works.** The memory-on arm reads memory and uses the value. The memory-off arm has no memory tool and says it does not know. This is the effect the hypothesis is about.
- **The pilot delta is not a result.** It is one trial per cell, and one `mem-on` trial was lost to the 402. The compare endpoint reports `insufficient_data` (one common task), which is correct.
- **Infra failure, not a memory effect.** The 402 happened because the two trials ran at the same time (`TRIAL_CONCURRENCY` defaults to 2). OpenRouter reserves each in-flight request's budget, and the account had almost no credit, so one request was rejected before reaching the model. The worker classed it as a retryable `model_error`. Nothing in the memory path caused it.
- **Cost.** The whole pilot cost about $0.002 at list price (5,549 prompt and 56 completion tokens).

## Amendments made before the main run

Recorded 2026-11-21, after the pilot and before any main-run trial. They change how the run is operated, not the question or the metric.

1. **Infra failures make a run invalid, not just smaller.** `compare` excludes failed trials from the numbers, so an arm that loses trials to a 402, 429 or timeout would be scored on an easier subset. Rule: the main run counts only if every trial in both arms has `status: succeeded`. If any trial fails with `model_error` or `infra_error`, the cause is fixed and the whole experiment is re-run under the same name and config. Failed rows are not patched or dropped.
2. **Run sequentially.** The main run uses `TRIAL_CONCURRENCY=1`. This keeps OpenRouter's in-flight reservation small, so a low balance cannot reject a trial mid-run. Seeds are fixed, so concurrency does not change the outcome.
3. **Pilot deviation** is noted in the Pilot section above.

## Post-hoc v2: `write_file` enabled in both arms (labelled, written before its run)

**This is post-hoc.** It was decided after the main run, because the main run's `mem_deploy_file_01` could not pass for a reason the pre-registration did not foresee (the config left out `write_file`). The original result above stands and is not replaced. v2 is reported next to it.

- **Change, and only this:** `tools: ["write_file"]` in both arms (was `[]`). Config names become `mem-on-write_file` and `mem-off-write_file`, so they do not clash with the originals.
- **Unchanged:** the same five tasks, N = 10, the same model, harness and budgets, the same primary metric (macro Δ, on minus off), the same compare endpoint and verdict rule, and the same inspection rules.
- **What v2 can show:** whether `mem_deploy_file_01` can pass with memory on, and whether the `det_weekday_01` memory-on failure persists when `write_file` is also on. It cannot show whether the original result was a fluke, and it is not a second confirmation.
- **Interpretation rule:** report v2 beside the original, both with their verdicts. Do not average them, and do not pick the better one.

Main run: experiment `16da4716-6bd6-4a57-9adf-57f896874495` (name `memory-ab`), 100 trials, all `succeeded` (0 failed, 0 timeout). The run was valid under Amendment 1. Output in `results/memory-ab/` (`compare.json`, `export.json`, `export.csv`).

### Primary result (pre-registered metric, unchanged)

| | Macro pass rate | 95% CI (bootstrap over tasks) | Scored trials |
|---|---|---|---|
| mem-on (A) | 60.0% | [20.0%, 100.0%] | 50 |
| mem-off (B) | 60.0% | [20.0%, 100.0%] | 50 |
| **Δ (on − off)** | **0.0 pts** | **[−60.0, +60.0] pts** | McNemar p = 1.000 |

**Verdict from the compare endpoint: `likely_noise`.** Memory on and off give the same macro pass rate over the five pre-registered tasks. The interval is wide, as the limitations predicted.

### Per task (on − off)

| Task | Group | mem-on | mem-off | Δ |
|---|---|---|---|---|
| `mem_recall_client_01` | memory | 10/10 | 0/10 | +100 |
| `mem_deploy_file_01` | memory | 0/10 | 0/10 | 0 |
| `det_add_01` | control | 10/10 | 10/10 | 0 |
| `det_letter_count_01` | control | 10/10 | 10/10 | 0 |
| `det_weekday_01` | control | 0/10 | 10/10 | −100 |

Per group (descriptive, from the same trials): memory group Δ **+50 pts** (mem-on 50%, mem-off 0%). Control group Δ **−33 pts** (mem-on 67%, mem-off 100%). The control result does not match the hypothesis that controls stay unchanged. See the post-run findings.

### Cost and latency (list price, from token usage)

| Arm | Prompt / completion tokens | Cost | Mean latency |
|---|---|---|---|
| mem-on | 299,470 / 2,387 | $0.124 | 7,385 ms |
| mem-off | 19,763 / 380 | $0.009 | 2,254 ms |

Total about $0.13. `estimatedCostUsd` is still not measured by the API, so these are computed from tokens and the OpenRouter list price.

### Stop reasons

10 of 100 trials ended with Hermes's "Operation interrupted" text and no answer. All 10 are `det_weekday_01` in the mem-on arm, and all 10 are graded as failures. The export records them as `succeeded`, not as a budget stop. The trace does not say which budget was hit. So the three counts the pre-registration asked for (`max_tokens`, `max_steps`, `timeout`) cannot be reported separately from this run. That is a gap in the runner's stop-reason accounting, to fix before any later run.

### Inspected trajectories (selected by the pre-registered rules)

1. **Memory-off failure:** `96057f98-a746-47f2-8749-0285abca65d1` (`mem_recall_client_01`, trial 0). One step, 391 tokens. There is no memory tool call. The model answers "No client ID found in memory." Grader: `exact_match` expected `HL-2044`, got the sentence above.
2. **Memory-on success on the same trial index:** `34370d0c-31d7-483f-abfd-9ec30b423b10` (`mem_recall_client_01`, trial 0). Two steps, 4,744 tokens. The trace has one `memory_read` with query "client id". The tool returns `client_id = HL-2044`, and the answer is `HL-2044`. Grader: `exact_match` passed. This is the mechanism the hypothesis describes.
3. **Control where both pass:** `det_add_01` trial 0 (the first `det_*` task with a pass in both arms). mem-off `75086d07-2288-4d9b-903a-453f5d3e53eb`: one step, 380 tokens, answers `42`. mem-on `29250587-d9c0-4ff9-bcf8-d32fd05c1422`: two steps, 4,725 tokens. It makes an unneeded `memory_write` of `last_addition_result = 42`, then answers `42`. Both pass, but the memory-on arm spent about 12 times the tokens. Memory was not needed for this task.

### Post-run findings (not pre-registered; read with care)

These come from the traces, after the main run. They are explanations, not results. The pre-registered numbers above stand as they are.

- **`mem_deploy_file_01` cannot pass under the pre-registered config, in either arm. This is an error in my pre-registration, not a finding about memory.** The shared config has `tools: []`. Each trial is offered only its `toolIds` (`hermes_runner.py`), so the model never gets `write_file`, and the task needs it. In the mem-on trial `e55d0962-30e1-4c8b-beb1-d4adf92e5d8b` the model read both values correctly, then wrote the JSON with `memory_write` (a memory key called `deploy.json`) and replied "done". The grader found no file. So the 0/20 on this task reflects tool availability. It is included in the pre-registered macro average and dilutes it. I did not re-run or re-define the metric after seeing this, because that would be post-hoc tuning.
- **Memory search on a control caused the one large control drop.** On `det_weekday_01` in mem-on, the model called `memory_read` four times with different queries for "2026-01-01 day of the week". Every query returned no hits. It never answered and stopped on a budget. Trial `48bfc132-a2d7-450f-a693-6ea2d50b5a79`: 5 steps, 9,770 tokens, against a budget of 8,000. The mem-off arm answered `Thursday` in one step (`130863ef-d570-4fed-8851-7a0bd5996576`). Across all 10 mem-on trials the model made 38 `memory_read` calls on this task, and none returned a hit. The model searched memory for a fact it could compute.
- **Memory-on adds prompt size.** Memory tool schemas and the Hermes prompt add about 4,300 prompt tokens per trial. On `det_add_01` the mem-on trial used 4,725 tokens against 380 for mem-off. So the treatment is "memory tools and their context", not memory content alone.

### Post-hoc v2 results (`write_file` in both arms, labelled post-hoc)

Experiment `2189651f-4e58-4ec2-a9ac-bbf7892c7f1d` (name `memory-ab-v2-write-file`), 100 trials, all `succeeded`. Output in `results/memory-ab-v2-write-file/`. Cost about $0.26 at list price.

| | Macro pass rate | 95% CI | Scored |
|---|---|---|---|
| mem-on (`mem-on-write_file`) | 80.0% | [40.0%, 100.0%] | 50 |
| mem-off (`mem-off-write_file`) | 20.0% | [0.0%, 60.0%] | 50 |
| **Δ (on − off)** | **+60.0 pts** | **[+20.0, +100.0] pts** | McNemar p < 0.001 |

**Verdict from the compare endpoint: `a_better`.** This is the verdict the pre-registered rule gives for v2. It is not a cleaner answer than v1, for the reasons below.

Per task (on − off): `mem_recall_client_01` 10/10 vs 0/10; `mem_deploy_file_01` 10/10 vs 0/10; `det_add_01` 10/10 vs **0/10**; `det_letter_count_01` 10/10 vs 10/10; `det_weekday_01` 0/10 vs **0/10**.

What changed between v1 and v2, from the traces:

- **`mem_deploy_file_01` now passes with memory on (10/10).** With `write_file` available, the model writes `deploy.json` as the task asks. This confirms the v1 floor was the tool configuration, not the memory.
- **The no-memory arm on `det_add_01` now fails 10 of 10,** and 10 of 10 end on the budget. Trial `4b4a17e7-c903-41e7-9ba1-555013ebe4a6`: the model calls `write_file` on `calc.py` four times with the same content and never answers. This is the Phase 12 tool-first loop, now reached by a control whenever `write_file` is offered. In v1, with no file tool, the same control passed 10 of 10.
- **`det_weekday_01` fails in both arms.** Memory-on loops on `memory_read` (as in v1). Memory-off loops on `write_file` (trial `33aea625-a2b8-4bf3-98ae-1ac7c2ead337`). Both end on the budget.
- **30 of 100 trials ended on a budget** (all `det_add_01` mem-off and both `det_weekday_01` arms). The export still records them as `succeeded`.

So the +60 in v2 is mostly a control floor in the no-memory arm, which the tool change created. The memory effect itself is the same in both runs: on the two memory tasks, memory-on passes 20 of 20 trials and memory-off passes 0 of 20.

## Conclusion (cautious)

**On the memory tasks, the effect is consistent and large.** In both v1 and v2, memory on passes 20 of 20 and memory off passes 0 of 20, because the needed value lives only in memory. The mechanism is visible in the traces.

**The aggregate answer depends on the tool setting, so the aggregate does not settle the question.** The primary metric is a macro average over five tasks, and two of the five are controls. Those controls are not stable across the tool change:

- v1 (pre-registered, no file tool): Δ 0.0 pts, CI [−60, +60], `likely_noise`. The memory group is +50 pts. One control (`det_weekday_01`) drops because memory search wastes the budget.
- v2 (post-hoc, `write_file` on): Δ +60.0 pts, CI [+20, +100], `a_better`. The memory group is +100 pts. The control group is +33 pts, driven by a no-memory control floor (`det_add_01`) that the tool change caused.

Neither run supports a clean general claim. The pre-registered main run (v1) says memory did not move the aggregate. The post-hoc v2 says it did, but mostly through an artifact of the no-memory arm. Report both, with their verdicts. Do not pick the better one.

Under Hermes with `openai/gpt-4.1-mini`, the claim the data supports is narrow. Memory is necessary for facts that are only in memory. It can cost budget on questions the model could answer itself, and it adds about 4,300 prompt tokens per trial. The tool setting changes the controls a lot, so any future run must fix the tool list in advance and check the controls before reading the aggregate.

This is one model, one harness, two memory tasks, and five tasks in total. The result does not show that memory helps or hurts in general. A test with a usable deploy task and more memory tasks is needed before a stronger claim.

## Run status

- **Executed.** v1 (the pre-registered main run): 100 trials, 100 `succeeded`, about $0.13 of OpenRouter list-price usage. Then the labelled post-hoc v2: 100 trials, 100 `succeeded`, about $0.26. The account was topped up to $5 before the run. Neither run was re-run.
- **How it was run.** The worker ran with `TRIAL_CONCURRENCY=1`, set with a temporary compose override (`/tmp/p14-override.yml`), not in `.env`. The stack was the `p14` project at `localhost:3100`. The command was `npx tsx scripts/run-experiment.ts --name memory-ab --n 10 --configs mem-off,mem-on --tasks memory,control`.
- **Controls kept**, as pre-registered. The `det_add_01` floor did not happen: it passed 10 of 10 in both arms. The one large control drop is `det_weekday_01` (see Results, post-run findings).
- **v2 (post-hoc).** Run after the v1 results, with `--tools write_file` (new script option; the default stays `[]`). Command: `npx tsx scripts/run-experiment.ts --name memory-ab-v2-write-file --n 10 --configs mem-off,mem-on --tasks memory,control --tools write_file`. It is reported beside v1, not in place of it.
- **Not done.** No run beyond v1 and v2. Neither run is a confirmation of the other. Any further run needs its own pre-registration, with the tool list and the control check written down before it starts.
