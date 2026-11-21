# Cost

This file covers how cost is estimated, how the estimate was checked by hand against the stored data and the provider's bill, what was actually spent, and what the platform does and does not do to reduce cost.

Two numbers are kept apart throughout:

- **List-price estimate**: tokens × the list prices in `prices.json`. This is what the platform stores in `estimatedCostUsd`.
- **Billed**: what OpenRouter charged the account (`GET /api/v1/credits`, `total_usage`). This is the real spend.

They do not agree, and §4 explains why.

## 1. Formula

Per the assignment template (implementation.md §21):

```
Cost ≈ T × N × C × (ū_in · P_in + ū_out · P_out)  +  J × ū_judge · P_judge
```

- `T` tasks, `N` trials per config, `C` configs
- `ū_in`, `ū_out`: average prompt and completion tokens per agent trial
- `P_in`, `P_out`: list price per token of the agent model
- `J`: number of judge calls (one per `llm_judge` grader run), `ū_judge`: average judge tokens per call, `P_judge`: list price of the judge model

The discrete form the code uses (`packages/runner/src/run-trial.ts`, `estimateCost`):

```
estimatedCostUsd = Σ over agent calls   (promptTokens · inPerMTok  + completionTokens · outPerMTok) / 1e6
                 + Σ over judge calls   (promptTokens · inPerMTok  + completionTokens · outPerMTok) / 1e6
```

Each judge call's usage comes from the judge result. Trial metrics count agent tokens only (`metrics.promptTokens`, `metrics.completionTokens`); the judge tokens are added to the cost, not to the token counts.

### Where the price comes from

- `prices.json` at the repo root holds list prices in USD per million tokens, with `asOf` and `source`. The source is OpenRouter's public model list (`pricing.prompt`, `pricing.completion`). Cache-read prices are not used.
- The API loads it once per process (`apps/api/src/execution/prices.ts`; `PRICE_TABLE_PATH` overrides the location, and the image copies it to `/app/prices.json`).
- The runner checks every model it will call, the agent and each judge, before the trial starts. A model without a price fails the trial with `price_missing` (non-retryable) and makes no model call. The validator (`scripts/validate-task-set.ts`) applies the same check to every `llm_judge` `judgeModel`, so a task set cannot ship with an unpriced judge.

Current table (`asOf` 2026-11-21):

| Model | Input $/1M tok | Output $/1M tok | Used for |
|---|---:|---:|---|
| `openai/gpt-4.1-mini` | 0.40 | 1.60 | Agent (every experiment in this repo) |
| `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | Second model (single live check, Phase 13) |
| `google/gemini-2.5-flash` | 0.30 | 2.50 | Judge (all five `llm_judge` tasks; judge validation) |

## 2. Hand exercise against the stored data

The 204 trials (Phase 14: pilot 4, v1 100, v2 100) were exported from the API (`results/*/export.json`). The list-price figures below were recomputed from each trial's token counts with the formula above. Pooled per-trial averages are rounded to whole tokens for display; totals are exact.

Every trial in these runs is an agent-only trial (the memory and control tasks have no `llm_judge` grader), so the judge term is 0 for all of them.

| Run | Arm | Trials | Avg prompt tok | Avg completion tok | List cost |
|---|---|---:|---:|---:|---:|
| pilot | mem-on | 2 | 2,361 | 11.0 | $0.00192 |
| pilot | mem-off | 2 | 414 | 17.0 | $0.00039 |
| v1 (pre-registered) | mem-on | 50 | 5,989 | 47.7 | $0.12361 |
| v1 (pre-registered) | mem-off | 50 | 395 | 7.6 | $0.00851 |
| v2 (post-hoc, `write_file`) | mem-off | 50 | 6,163 | 146.0 | $0.13495 |
| v2 (post-hoc, `write_file`) | mem-on | 50 | 5,973 | 48.2 | $0.12333 |
| **All** | | **204** | | | **$0.39270** |

Check the formula on one row. v1 mem-on: T = 5 tasks, N = 10, C = 1, so the formula gives

```
5 × 10 × (5,989 × 0.40 + 47.7 × 1.60) / 1e6
= 50 × (2,395.6 + 76.3) / 1e6
= 50 × 0.0024719
= $0.12360
```

against the metered $0.12361 (the difference is the rounding of the displayed averages). The other rows reproduce the same way.

**Judge term, checked on a live judge trial.** One `judge_summary_01` trial (agent `openai/gpt-4.1-mini`, judge `google/gemini-2.5-flash`) ran through the Phase 15 build:

| Part | Tokens (prompt / completion) | Price | Cost |
|---|---:|---|---:|
| Agent | 445 / 47 | 0.40 / 1.60 | $0.0002532 |
| Judge | 363 / 125 | 0.30 / 2.50 | $0.0004214 |
| **Total** | | | **$0.0006746** |

The stored `metrics.estimatedCostUsd` is `0.0006746`. It matches the hand sum exactly.

**Judge validation (separate from the experiments).** The 25 labelled answers in `fixtures/judge-human-labels` were judged with `google/gemini-2.5-flash` (`judge-validation.txt`): 8,977 prompt and 3,367 completion tokens in total.

```
(8,977 × 0.30 + 3,367 × 2.50) / 1e6 = $0.0111
```

That run predates metering, so the figure is hand-computed only.

## 3. Stored `estimatedCostUsd` against the hand sum

- **Trials recorded before Phase 15 have no stored cost.** Metering was added after the Phase 14 runs. For the 204 trials, `estimatedCostUsd` is absent, so a sum over the database is empty for those runs. The compare endpoint reports the mean cost as `null` for them (it excludes absent costs, it does not count them as zero).
- **The only metered trial** is the live judge trial above. Its stored value equals the hand sum to the last digit.

So the database gap for the Phase 14 runs is total (the costs were never stored), and the formula is verified on the one trial that has them.

## 4. Gap between list price and the provider's bill

| Measure | Value |
|---|---:|
| List-price estimate, Phase 14 (204 trials, §2) | $0.39270 |
| Billed, pilot and main runs | ≈ $0.19 |
| Billed, Phase 15 checks (live judge trial, cache probe) | ≈ $0.002 |

The billed figures come from `total_usage` on `GET /api/v1/credits`. The reading before the pilot was `0.09`, which is recorded rounded, so the pilot-and-main figure is good to about ±$0.005. A later reading of `0.2804` (taken before the Phase 15 probes) and the current reading of `0.282633` give the two deltas above.

The list estimate is about twice the billed amount. The cause that explains it is **prompt caching**:

- The agent sends the same system prompt and tool schemas in every trial, so most of each prompt is a repeated prefix.
- A probe call (`/tmp` script, not committed) on `openai/gpt-4.1-mini` reported 1,920 of 2,418 prompt tokens as cached. It was billed $0.00039 against a list estimate of $0.00097.
- The memory-on arm has the largest prompts (about 6,000 tokens, mostly the memory tool schemas and prompt). It accounts for $0.24694 of the $0.39270 list total, so most of the discount lands there.

This is consistent with the gap, but it is **not measured per trial**. The OpenRouter adapter does not persist the cached-token fields, so the split between cached and uncached tokens exists only for the single probe call. Judge tokens are not part of this gap: none of the 204 trials had a judge call. The judge validation (Phase 9) was billed before the baseline reading, so it is outside the ≈ $0.19.

Per completed trial (203 of 204 succeeded):

- List estimate: $0.39270 / 203 = **$0.00193**
- Billed: ≈ $0.19 / 203 = **≈ $0.00094**

## 5. Actual spend

| Item | Value |
|---|---|
| Agent tokens (gpt-4.1-mini, all 204 trials) | 931,620 prompt, 12,535 completion |
| Judge tokens, experiments | 0 (no `llm_judge` task in the Phase 14 subset) |
| Judge tokens, validation (gemini-2.5-flash, 25 labels) | 8,977 prompt, 3,367 completion |
| Judge tokens, live judge trial (Phase 15 check) | 363 prompt, 125 completion |
| List estimate, experiments | $0.39270 (hand, from exports; not stored in DB) |
| Billed, pilot and main experiment | ≈ $0.19 |
| Billed, Phase 15 checks (live judge trial, cache probe) | ≈ $0.002 |
| Billed, judge validation (Phase 9, before the baseline reading) | Not in the figures above; estimated at $0.011 list |
| Provider dashboard screenshot | Not taken |

The account's totals come from `GET /api/v1/credits`: `total_credits` 5 and `total_usage` 0.282633 at the time of writing. The top-up was $5, so the experiments were funded with room to spare.

## 6. Reduction strategies (what exists, what does not)

Status is stated as it is in the repo, not as planned.

| Strategy | Status | Notes |
|---|---|---|
| **Response caching** for `(modelId, messagesHash)` | **Not implemented** | No response cache. Provider prompt caching is already active and is the main source of the list-to-billed gap (§4). |
| **Early stopping** of a config on a task | **Not implemented** | Experiments always run every trial. There is no sequential rule and no per-experiment spend ceiling. |
| **Sampling**: full N on a discriminating subset, fewer trials on the rest | **Partly** | The memory A/B ran 5 tasks at N = 10 (100 trials per arm pair), not the 21-task catalog. Smoke checks used N = 1. |
| **Cheaper model for debugging**, expensive model for the final A/B | **Not done deliberately** | Every experiment here used `gpt-4.1-mini`. The second model (`claude-haiku-4.5`, Phase 13) was a single live check. |
| **Judge only where deterministic graders are not enough** | **Done** | 16 of 21 tasks use deterministic graders only. The five `llm_judge` tasks are the only ones that call the judge. One judged trial costs about $0.0007 at list price. |
| **Per-trial token caps** | **Done** | `maxSteps`, `maxTokens` and `timeoutMs` are set per config and enforced in the harness and runner. |

Two limits on the caps: a trial that stops on a budget is recorded as `succeeded` (the stop reason is not exported, see LIMITS.md §7), and the cap is per trial, not per experiment.

## 7. Projection for the next run

This is an extrapolation, not a measurement. The full catalog (21 tasks) at N = 10 with two configs is 420 trials. At the observed average list cost of $0.00193 per completed trial, that is about **$0.8 at list price**, or about **$0.4 billed** at the observed ratio. The real figure depends on the mix: the memory-on arm costs about 14 times the memory-off arm per trial on these tasks, and the judge adds about $0.0004 per judge call.
