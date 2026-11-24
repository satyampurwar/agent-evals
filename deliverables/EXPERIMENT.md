# Experiment: Hermes memory on vs off (full catalog)

One real experiment along a **single axis**: `memory.enabled` (on vs off). Same harness (Hermes), same model (`openai/gpt-4.1-mini`), same tools and skills. Artifacts: `results/9b9a088d-b4b5-47ae-915b-d5ae169c787b/` (`compare.json`, `export.json`, `export.csv`). Re-run:

```bash
npx tsx scripts/run-experiment.ts --name full-catalog --n 5 --configs mem-off,mem-on --tasks all
```

In this run’s `compare.json`, config A is `mem-off` and B is `mem-on` (first `configId` on the experiment). The tables below report **mem-on − mem-off** so the sign matches the hypothesis.

## 1. Hypothesis

With the same model and harness, turning on the trial’s memory tools raises the pass rate on tasks that depend on seeded memory. On tasks that need no memory, the pass rate should be largely unchanged.

## 2. Setup and number of trials

| Item | Value |
|---|---|
| Axis | `memory.enabled` only |
| Config A (in `compare.json`) | `mem-off` — memory tools off |
| Config B (in `compare.json`) | `mem-on` — memory tools on, `persistAcrossTrials: false` |
| Harness | `hermes` (Hermes Agent via Python worker) |
| Model | `openrouter:openai/gpt-4.1-mini`, temperature 0 |
| Shared budgets | `maxSteps: 8`, `maxTokens: 8000`, `timeoutMs: 120000` |
| Shared tools | `read_file`, `write_file`, `list_dir` |
| Shared skills | `csv_summary` (enabled on both arms) |
| N | **5 trials** per task per config |
| Total | 22 tasks × 2 configs × 5 = **220 trials** (all `succeeded`) |
| Concurrency | `TRIAL_CONCURRENCY=1` |
| Wall clock | ~12 minutes (`2026-11-24T19:05Z` → `19:17Z`) |
| Experiment id | `9b9a088d-b4b5-47ae-915b-d5ae169c787b` |
| Config mem-off id | `84491ef7-78b7-4a6d-b834-ec65a7b9d188` |
| Config mem-on id | `cc7b3cd6-7bc7-42fa-a086-8addff6a70f5` |

**Tasks:** the full 22-task catalog (`--tasks all`): 13 deterministic, 5 LLM-judged, 2 memory, 2 skill.

**Primary metric:** difference in macro pass rate (mem-on − mem-off), with paired bootstrap 95% CI over tasks and exact McNemar on paired trials (`GET .../compare`).

## 3. Results with confidence intervals

| | Macro pass rate | 95% CI (bootstrap over tasks) | Scored trials |
|---|---|---|---|
| mem-on | 86.4% | [72.7%, 100%] | 110 |
| mem-off | 74.5% | [56.4%, 90.9%] | 110 |
| **Δ (on − off)** | **+11.8 pts** | **[0.0, +25.5] pts** | McNemar p ≈ 0.00024 |

**Verdict: `likely_noise`** (bootstrap interval includes 0; platform `noise: true`). McNemar is significant on discordant pairs (onOnly 13, offOnly 0), but the task-level interval still touches zero — report both. Raw `compare.json` stores A=mem-off, so its `delta` is the negation (−11.8 pts, CI [−25.5, 0]).

| Task | Group | mem-on | mem-off | Δ (pts) |
|---|---|---|---|---|
| `mem_recall_client_01` | memory | 5/5 | 0/5 | +100 |
| `mem_deploy_file_01` | memory | 5/5 | 0/5 | +100 |
| `det_letter_count_01` | det | 5/5 | 2/5 | +60 |
| `det_add_01` | det | 0/5 | 0/5 | 0 |
| `det_weekday_01` | det | 0/5 | 0/5 | 0 |
| `skill_csv_sum_01` | skill | 0/5 | 0/5 | 0 |
| `skill_csv_mean_01` | skill | 5/5 | 5/5 | 0 |
| Other det / judge (15 tasks) | — | 5/5 | 5/5 | 0 |

Cost (list price from compare / tokens × `prices.json`): mem-on ≈ **$0.253**, mem-off ≈ **$0.246**; total ≈ **$0.50**. Mean latency ≈ 3.2 s on both arms. Mean tokens ≈ 5.1k–5.3k per trial (prompt-heavy Hermes prefix).

## 4. Inspected trajectories

1. **Memory-off failure** — `1a41479a-945f-4dc5-9a74-f1c137527c8b` (`mem_recall_client_01`, trial 0). No memory tools. Agent tried `read_file` on `.hermes-home/profiles/default/memories/memory.json` (not found) and never produced the ID. Exact-match expected `HL-2044` → fail.

2. **Memory-on success (same task / index)** — `ccebd43a-d734-48c2-929a-c2a176c1f2ee`. `memory_read` (“client id”) returns `client_id = HL-2044`; assistant answers `HL-2044` → pass. This is the mechanism the hypothesis describes. Deploy shows the same pattern with file write: mem-on `8fd17551-…` pass vs mem-off `281415c6-…` fail.

3. **Control pollution from shared skills** — `1ec4639d-8509-487d-bb6d-ac42c8133914` (`det_letter_count_01`, mem-off, trial 0). Prompt asks for only the number `4`. Agent called `csv_summary` with invalid args, then answered in a sentence → exact-match fail. Same task mem-on `0099375c-…` answered `4` in one step → pass. Related: both arms hit `max_tokens` on `det_weekday_01` / `det_add_01` after repeated failed `csv_summary` loops (`9fdc2dc5-…`, `4b5344ea-…`).

## 5. Conclusion

- **On memory tasks, the effect is large and consistent:** with file tools available, both memory tasks pass with memory on (10/10) and fail with memory off (0/10); traces show `memory_read` (and deploy write) only when memory is enabled.
- **On the full-catalog aggregate, memory did not clear the noise bar:** Δ = +11.8 pts, CI [0, +25.5], verdict `likely_noise`. Most of the catalog is already at ceiling for both arms; the macro lift is driven by the two memory tasks plus one control (`det_letter_count_01`, +60 pts) that flipped for reasons unrelated to memory content.
- **Shared `csv_summary` skill hurts some non-skill controls** via tool loops / verbose answers (`det_letter_count_01`, `det_weekday_01`, `det_add_01`). That is a harness × toolset interaction, not evidence that memory helps arithmetic.
- **Narrow claim supported:** under Hermes + `gpt-4.1-mini` with this tool/skill set, memory tools are necessary for seeded memory facts; enabling memory does not reliably improve the rest of the 22-task catalog at N = 5. This does **not** show that memory helps or hurts in general.
