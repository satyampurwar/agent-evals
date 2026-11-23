# Experiment: Hermes memory on vs off (full catalog)

One real experiment along a **single axis**: `memory.enabled` (on vs off). Same harness (Hermes), same model (`openai/gpt-4.1-mini`), same tools and skills. Artifacts: [`results/full-catalog/`](../results/full-catalog/) (`compare.json`, `export.json`, `export.csv`). Re-run:

```bash
npx tsx scripts/run-experiment.ts --name full-catalog --n 3 --configs mem-off,mem-on --tasks all
```

## 1. Hypothesis

With the same model and harness, turning on the trial’s memory tools raises the pass rate on tasks that depend on seeded memory. On tasks that need no memory, the pass rate should be largely unchanged.

## 2. Setup and number of trials

| Item | Value |
|---|---|
| Axis | `memory.enabled` only |
| Config A | `mem-on-…` — memory tools on, `persistAcrossTrials: false` |
| Config B | `mem-off-…` — memory tools off |
| Harness | `hermes` (Hermes Agent via Python worker) |
| Model | `openrouter:openai/gpt-4.1-mini`, temperature 0 |
| Shared budgets | `maxSteps: 8`, `maxTokens: 8000`, `timeoutMs: 120000` |
| Shared tools | `read_file`, `write_file`, `list_dir` |
| Shared skills | `csv_summary` (enabled on both arms) |
| N | **3 trials** per task per config |
| Total | 21 tasks × 2 configs × 3 = **126 trials** (all `succeeded`) |
| Concurrency | `TRIAL_CONCURRENCY=1` |
| Wall clock | ~7.5 minutes (`2026-11-23T15:46Z` → `15:54Z`) |
| Experiment id | `48e5c41f-87ce-4ff8-a786-c95d56d22992` |
| Config A id | `e355cd4f-375c-41d9-a66a-3271561ccfeb` |
| Config B id | `374ed4d8-fbf1-4acb-961b-23bad403839d` |

**Tasks:** the full 21-task catalog (`--tasks all`): 12 deterministic, 5 LLM-judged, 2 memory, 2 skill.

**Primary metric:** difference in macro pass rate (mem-on − mem-off), with paired bootstrap 95% CI over tasks and exact McNemar on paired trials (`GET .../compare`).

## 3. Results with confidence intervals

| | Macro pass rate | 95% CI (bootstrap over tasks) | Scored trials |
|---|---|---|---|
| mem-on (A) | 87.3% | [73.0%, 100%] | 63 |
| mem-off (B) | 73.0% | [54.0%, 90.5%] | 63 |
| **Δ (on − off)** | **+14.3 pts** | **[0.0, +33.3] pts** | McNemar p ≈ 0.012 |

**Verdict: `likely_noise`** (bootstrap interval includes 0; platform `noise: true`). McNemar is significant on discordant pairs (aOnly 10, bOnly 1), but the task-level interval still touches zero — report both.

| Task | Group | mem-on | mem-off | Δ (pts) |
|---|---|---|---|---|
| `mem_recall_client_01` | memory | 3/3 | 0/3 | +100 |
| `mem_deploy_file_01` | memory | 3/3 | 0/3 | +100 |
| `det_letter_count_01` | det | 3/3 | 0/3 | +100 |
| `det_add_01` | det | 1/3 | 1/3 | 0 |
| `det_weekday_01` | det | 0/3 | 0/3 | 0 |
| `skill_csv_sum_01` | skill | 0/3 | 0/3 | 0 |
| `skill_csv_mean_01` | skill | 3/3 | 3/3 | 0 |
| Other det / judge (14 tasks) | — | 3/3 | 3/3 | 0 |

Cost (list price from compare / tokens × `prices.json`): mem-on ≈ **$0.141**, mem-off ≈ **$0.141**; total ≈ **$0.28**. Mean latency ≈ 3.5 s on both arms. Mean tokens ≈ 5.1k per trial (prompt-heavy Hermes prefix).

## 4. Inspected trajectories

1. **Memory-off failure** — `7505687c-234c-4aef-a55e-044ad75d4dd7` (`mem_recall_client_01`, trial 0). No memory tools. Agent tried `read_file` on `.hermes-home/memories/default/memory.json` (not found) and never produced the ID. Exact-match expected `HL-2044` → fail.

2. **Memory-on success (same task / index)** — `1bf49822-f075-4f56-8ad3-27a80e196a80`. `memory_read` (“client id”) returns `client_id = HL-2044`; assistant answers `HL-2044` → pass. This is the mechanism the hypothesis describes. Deploy shows the same pattern with file write: mem-on `ef5d04b6-…` pass vs mem-off `f5f74636-…` fail.

3. **Control pollution from shared skills** — `ceb6d7e6-6c40-4a46-a9ce-efe385049930` (`det_letter_count_01`, mem-off, trial 0). Prompt asks for only the number `4`. Agent called `csv_summary` with invalid args, then answered in a sentence → exact-match fail. Same task mem-on `5fe84f39-…` answered `4` in one step → pass. Related: both arms hit `max_tokens` on `det_weekday_01` after repeated failed `csv_summary` / `read_file` loops (`d66a6e46-…`).

## 5. Conclusion

- **On memory tasks, the effect is large and consistent:** with file tools available, both memory tasks pass with memory on (6/6) and fail with memory off (0/6); traces show `memory_read` (and deploy write) only when memory is enabled.
- **On the full-catalog aggregate, memory did not clear the noise bar:** Δ = +14.3 pts, CI [0, +33.3], verdict `likely_noise`. Most of the catalog is already at ceiling for both arms; the macro lift is driven by the two memory tasks plus one control (`det_letter_count_01`) that flipped for reasons unrelated to memory content.
- **Shared `csv_summary` skill hurts some non-skill controls** via tool loops / verbose answers (`det_letter_count_01`, `det_weekday_01`, intermittent `det_add_01`). That is a harness × toolset interaction, not evidence that memory helps arithmetic.
- **Narrow claim supported:** under Hermes + `gpt-4.1-mini` with this tool/skill set, memory tools are necessary for seeded memory facts; enabling memory does not reliably improve the rest of the 21-task catalog at N = 3. This does **not** show that memory helps or hurts in general.
