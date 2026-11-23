# Cost estimate

## 1. Formula

Cost per experiment (list price):

```
Cost ≈ T × N × C × (ū_in · P_in + ū_out · P_out)  +  J × ū_judge · P_judge
```

| Symbol | Meaning |
|---|---|
| `T` | Number of tasks |
| `N` | Trials per task per config |
| `C` | Number of configs |
| `ū_in`, `ū_out` | Average prompt / completion tokens per agent trial |
| `P_in`, `P_out` | List price per token (from `prices.json`, USD per million → divide by 1e6) |
| `J` | Number of `llm_judge` calls |
| `ū_judge`, `P_judge` | Average judge tokens and judge list price |

What the runner / compare path stores as cost is the same idea applied per trial: sum agent and judge token usage × list prices. Agent token totals stay agent-only; judge tokens are priced into cost separately.

Prices used here ([`prices.json`](../prices.json), `asOf` 2026-11-21): `openai/gpt-4.1-mini` $0.40 / $1.60 per 1M in/out; `google/gemini-2.5-flash` (judge) $0.30 / $2.50.

## 2. Actual spend (full-catalog memory A/B)

Scored assignment run: **21 tasks × 2 configs × N = 3 = 126 trials**, Hermes × `gpt-4.1-mini`, tools `read_file`/`write_file`/`list_dir`, skill `csv_summary`. Five judge tasks × 3 × 2 = **30** judge calls (`J = 30`). Artifacts: [`results/full-catalog/`](../results/full-catalog/). Experiment id `48e5c41f-87ce-4ff8-a786-c95d56d22992`.

| Arm | Trials | Avg prompt | Avg completion | Judge prompt / completion (sum) | List cost (compare) |
|---|---:|---:|---:|---:|---:|
| mem-on | 63 | 5,031 | 75 | 6,339 / 1,961 | ≈ **$0.141** |
| mem-off | 63 | 4,988 | 77 | 6,313 / 2,042 | ≈ **$0.141** |
| **All** | **126** | ≈ 5,010 | ≈ 76 | | **≈ $0.28** |

Example plug-in (agent tokens only, both arms):  
`(316963 + 314261) × 0.40 / 1e6 + (4716 + 4853) × 1.60 / 1e6 ≈ $0.268`.  
Judge (Gemini Flash list): `(12652 × 0.30 + 4003 × 2.50) / 1e6 ≈ $0.014`.  
**Total list ≈ $0.28**, matching compare `meanCostUsd × scoredTrials`.

| Measure | Value |
|---|---|
| List-price estimate (exports / compare) | **≈ $0.28** |
| Wall clock at `TRIAL_CONCURRENCY=1` | **≈ 7.5 minutes** |
| Per completed trial (list) | ≈ **$0.0022** |

OpenRouter billed spend for this run was not re-checked against the provider dashboard at write-up time. Prior OpenRouter usage on this stack billed roughly **half** of list because of **provider prompt caching**. The adapter does not persist cached-token fields, so the discount shows on the bill, not per trial.

Judge validation (25 labels, separate from the experiment): ≈ **$0.011** at list for Gemini Flash ([`judge-validation.txt`](../judge-validation.txt)).

## 3. How to reduce cost

| Strategy | Approach |
|---|---|
| **Caching** | Reuse identical model requests (response cache on `(modelId, messagesHash)`). Provider prompt caching already cuts billed cost on repeated prefixes; a local response cache would skip repeat calls entirely for smoke/debug. |
| **Early stopping** | Stop a config on a task once a sequential rule shows the arm cannot catch up (or once an experiment spend ceiling is hit). Today every planned trial always runs. |
| **Sampling** | Full `N` only on discriminating tasks; smaller `N` (or skip) on the rest. This run used the full 21-task catalog at N = 3 (126 trials, ≈ $0.28). Prefer cheap models for harness debug; reserve the target model for the scored run. Prefer deterministic graders where they suffice — only 5/21 tasks call an LLM judge. |
| **Tool/skill set** | Enabling `csv_summary` on every trial adds prompt tokens and can burn steps on non-skill tasks (see [EXPERIMENT.md](EXPERIMENT.md)). Scope skills to skill-tagged tasks when cost or noise matters. |

Per-trial caps (`maxSteps`, `maxTokens`, `timeoutMs`) already bound the worst case; they do not replace experiment-level early stop or sampling.
