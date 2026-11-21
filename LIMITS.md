# Known Limits

What the platform and its results can and cannot support. Items 1–10 follow the assignment's list. Each is tied to something in this repo or in the Phase 14 runs. Items 11–18 are limits found while building; they are not in the assignment list but change how the results should be read.

## 1. Task-set size

The catalog has **21 tasks**: 12 deterministic, 5 LLM-judged, 4 discriminating (2 memory, 2 skill). That is enough to show the mechanics. It is not enough to rank agents or to represent production work.

The memory experiment used **5 tasks** (2 memory, 3 control). A macro-average over 5 tasks has a bootstrap interval of about ±60 points in v1 (`EXPERIMENT.md`). The result is indicative only.

## 2. Judge bias and variance

- **Agreement is measured on 25 labels, not on a population.** Agreement 92% (23/25), Cohen's κ 0.826, over 5 tasks with 5 labels each (`judge-validation.txt`). The interval on κ at n = 25 is wide.
- **The labels were written by one person.** There is no second labeller, so there is no inter-rater agreement to compare the judge against. The 25 labels are 9 pass and 16 fail.
- **The two disagreements went one way each.** `lbl_14` (`judge_email_01`): the human passed a borderline email, and the judge failed it on politeness and on the one-sentence reason rule. `lbl_24` (`judge_tradeoff_01`): the human failed a bullet that names a benefit with no cost, and the judge passed it. The rubric was not edited to fit them. Editing it on these labels would tune it to the validation set.
- **Not measured:** verbosity preference, self-preference when the judge and agent share a family, and rubric gaming. The judge (`google/gemini-2.5-flash`) is a different family from the agent (`openai/gpt-4.1-mini`), which reduces the self-preference risk, but does not measure it.
- **Judge failures can lose tokens.** The judge retries once on a malformed reply, and the usage for a successful grade includes both attempts (`llm-judge.ts`). If both attempts are malformed, the judge throws `JudgeOutputError`, the runner gets no usage for that grader, and its cost is not counted (`packages/runner`). That is a known gap in the metering.

## 3. Contamination

The tasks are small and written for this project. The memory facts are unusual strings (for example `client_id = HL-2044`), so the model cannot answer them from training data alone. The judge rubrics and some task wording may still resemble public material. Contamination was not tested (no held-out or perturbed variant of each task was run). Prefer novel, locally generated fixtures for any claim beyond this set.

## 4. Harness-specific quirks

Hermes and the baseline harness behave differently, and the results depend on it:

- **Hermes loops on tools.** In v2, `det_add_01` in the no-memory arm failed 10 of 10: the model called `write_file` on the same file repeatedly and ran out of budget (`EXPERIMENT.md`, Post-hoc v2 results). The same tool-first loop appeared on this task in a Phase 12 Hermes check.
- **Memory search can waste the budget.** On `det_weekday_01` in the memory-on arm, the model made 38 `memory_read` calls across 10 trials, none of them returned a hit, and it never answered (`EXPERIMENT.md`, post-run findings).
- **Memory tools cost prompt tokens.** With memory on, the prompt is about 4,300 tokens larger per trial, even when no memory is read. The memory treatment is "memory tools and their prompt", not memory content alone.
- **Skills are not implemented in Hermes.** Hermes ignores `skillIds`. The skill-tagged tasks run through a `csv_summary` tool in the platform's tool set, and they are never run in an experiment.
- **`persistAcrossTrials` is stored, not implemented.** A config can set it, and the runner ignores it. Every trial starts with an empty memory.

## 5. Multiple comparisons

Per-task deltas are reported and are not tested for significance. Five per-task comparisons at N = 10 each would have a family-wise error rate well above 5% if read as separate tests. Treat them as exploratory.

The verdict also depends on the tool setting. v1 (no `write_file`) gave `likely_noise`. v2 (`write_file` on, decided after the main run) gave `a_better`. Neither is the answer on its own, and the v2 choice was made after seeing v1 (labelled as post-hoc in `EXPERIMENT.md`).

## 6. Isolation limits

- **Each trial gets a fresh temporary directory on the host** (`createSandbox`, `mkdtemp` under `TMPDIR`), not a container. Path resolution rejects absolute paths, `..` escapes, and symlinks that leave the sandbox (`packages/sandbox`, with unit tests).
- **The Hermes worker is one process**, so anything Hermes does outside the platform's tools shares that process's environment. Hermes's own memory store is off (`skip_memory=True`), `HERMES_HOME` is pinned to one directory per worker, and the per-trial toolset is an allow-list of this platform's tools (`hermes_runner.py`). The trace checks confirm the tools used in each trial, but the list of Hermes built-ins was not audited one by one for host-filesystem reach.
- **The worker and the sandboxes share a volume** in compose (`/sandboxes`), so a bug that wrote outside a trial's directory would be visible to the next trial.

## 7. Provider nondeterminism and silent model changes

- **`temperature` 0 is not treated as determinism.** The platform does not assume a config reproduces its answers, so every comparison uses N = 10 trials per arm and reports intervals (implementation.md §2, assumption 3).
- **Model ids are not date-pinned.** `openai/gpt-4.1-mini` is whatever OpenRouter routes to at call time.
- **Models disappear.** The planned second model, `anthropic/claude-3.5-haiku`, returned `404: no provider serves this model anymore` during Phase 13. The replacement, `anthropic/claude-haiku-4.5`, was used for a single check only.
- **Prices change.** `prices.json` is a snapshot (`asOf` 2026-11-21). Cost figures are only as current as that table.

## 8. Infrastructure failures

Infra failures are not agent failures, and the platform keeps them apart:

- A trial that hits a retryable infra error (`model_error`) is retried by BullMQ up to 3 times with exponential backoff, then recorded as `failed` with its error code. Non-retryable setup errors are recorded at once. It is never scored as a wrong answer, and the compare endpoint excludes it from the verdict and reports it separately.
- The Phase 14 pilot hit an OpenRouter `402 in_flight_budget_exhausted` on one trial. The cause was two concurrent trials on a nearly empty balance. The fix (`TRIAL_CONCURRENCY=1`) and the decision to re-run the whole experiment are recorded in `EXPERIMENT.md` (Amendments 1 and 2).

The reverse case is not handled. A **budget stop is recorded as `succeeded`**: when a trial runs out of steps or tokens, it exports as a success with no answer, and the grader scores it as a failure. In Phase 14, 10 trials in v1 and 30 in v2 ended this way, and the export cannot tell which budget was hit (item 11).

## 9. Statistical power

At N = 10, the standard error of one arm's pass rate is at most √(0.25/10) ≈ 0.16. For a difference between two arms, the worst case (both pass rates near 0.5) gives a standard error of about 0.22. At 80% power and α = 0.05, that is a minimum detectable difference of about **63 points on one task**. Smaller effects need more trials per task or more tasks, and the task-level bootstrap widens the interval further when there are few tasks.

So with N = 10 and 5 tasks, only very large effects are detectable. A `likely_noise` verdict means "the effect is not distinguishable from zero with this design", not "there is no effect".

## 10. External tools

Scored tasks have no live web access. The tools are local to the sandbox: `memory_read`, `memory_write`, `read_file`, `write_file`, `list_dir`, `csv_summary`. This keeps runs reproducible, and it means the results say nothing about agents that rely on live search or external APIs.

## 11. Stop reasons are not exported

The harness reports why a trial stopped (`completed`, `max_steps`, `max_tokens`, `timeout`, `error`), but the export records `succeeded`, `failed` or `timeout` only. Runs that ran out of budget therefore look like answers. In Phase 14, 40 of 200 `mem-on`/`mem-off` trials across v1 and v2 ended on a budget, and none of them is marked as one in the export. The pre-registration asked for counts of each stop reason, and those counts cannot be reported from the stored data.

## 12. Cost accounting is an estimate

- The stored `estimatedCostUsd` is the **list-price estimate**. It does not model prompt-cache discounts, so it is about twice the provider's bill for the Phase 14 runs (COST.md §4).
- **Trials recorded before Phase 15 have no cost.** The Phase 14 runs have no stored cost, so the database cannot be summed for them.
- **There is no experiment budget.** Caps are per trial (`maxSteps`, `maxTokens`, `timeoutMs`). Nothing stops an experiment once its total spend passes a limit.

## 13. Judge calls are not part of the stored token counts

Trial `metrics` hold the agent's tokens only. Judge tokens are priced into `estimatedCostUsd` but not reported as token counts, so a judged trial's token totals understate what it used.

## 14. The web Configs form creates only baseline configs

The Configs page hard-codes `harness.id: 'baseline'`. Hermes configs have to be created through the API (`POST /configs`), as `README.md` shows. This is a known follow-up, not a design decision.

## 15. Observability is not connected

The API is not linked to NestJS Observe, so the worker logs show a placeholder-keys warning. Traces are stored as JSON files and are the only record of a trial's steps. The fix is `npx @nestjs/observe link` (not run).

## 16. Persistence and deployment

- **The schema is created by TypeORM's `synchronize`** (default on, `DB_SYNCHRONIZE`). There are no migrations. That is fine for a demo and wrong for production.
- **The API has no authentication.** Anyone who can reach port 3000 can create configs and start experiments.
- **Trace files live on a volume** (`TRACE_DIR`). Their retention and cleanup are not defined.

## 17. Configs and names

Config names are not unique. Creating a config with an existing name and different content makes a new version under the same name, and creating one with identical content returns the existing config (`configs.service.ts`). Compare views show the name, so two configs can look alike to a reader. The content hash is the identity; the name is a label.

## 18. What was not verified

- **The Phase 11 browser drill was not run.** The UI pages were built and checked against the API, not clicked through by hand.
- **The compose stack was verified in Phase 13 but not re-run from a fresh clone in Phase 15.** The checklist in `implementation.md` §28 asks for this, and it is still open.
- **The demo video (implementation.md §25) was not recorded.** It is the one required deliverable this phase cannot produce.
