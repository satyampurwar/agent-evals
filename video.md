# Video

Everything the demo video must cover, with the script, the screens, the exact data to show, and what not to claim. Target **8 to 8:30**, hard limit **10 minutes** (implementation.md §25). Upload it unlisted (YouTube or Loom) and put the link in the README (see [After recording](#9-after-recording)).

## 1. What the video must show

| # | Must cover | Beat | Rubric area (implementation.md §27) |
|---|---|---|---|
| 1 | The problem in one sentence, and one architecture diagram | 1 | Judgment |
| 2 | Two configs that differ on **one axis**, immutable, with a content hash | 2 | Engineering quality |
| 3 | An experiment with a hypothesis and N, started, with visible progress | 3 | Engineering quality |
| 4 | The compare view: delta, confidence interval, per-task table, noise badge, cost, latency, tokens | 4 | Eval methodology |
| 5 | A **failed** trial: trajectory, tool calls, grader reasoning | 5 | Observability |
| 6 | Judge validation: agreement and κ, and the limits stated honestly | 6 | Eval methodology, Judgment |
| 7 | Where the adapters live, to show a harness or model is added without touching the core | 7 | Abstraction |

Also say out loud, because evaluators score judgment: the pre-registered result was noise, the pre-registration had a mistake, v2 is post-hoc, and cost is an estimate (§6).

## 2. Timeline

| Time | Beat | Screen | Length |
|---|---|---|---|
| 0:00 | 1. Problem and architecture | `DESIGN.md` §1 diagram | 0:40 |
| 0:40 | 2. Configs A and B | Configs page | 1:10 |
| 1:50 | 3. Experiment, start, progress | Experiments, then the experiment page | 1:10 |
| 3:00 | 4. Compare | Compare page: v1, then v2, then the cost view | 2:00 |
| 5:00 | 5. Failed trial | Trial page | 2:15 |
| 7:15 | 6. Judge validation and limits | `judge-validation.txt`, `LIMITS.md` | 0:55 |
| 8:10 | 7. Close: where the adapters live | `registry.ts` files | 0:20 |

Total about 8:30. If you run long, shorten beat 3 first, then beat 2. Never cut beat 5 or beat 6.

## 3. Before you record

### 3.1 Data to have ready

The memory experiment takes about 8 minutes, so do not run it on camera. Record against finished experiments.

**Use the existing stack, if it is still up.** The `p14` Compose project holds all the data below. UI: **http://localhost:5174**. API: http://localhost:3100. Do not run `docker compose -p p14 down -v` before recording: that deletes it.

| What | Where |
|---|---|
| v1, pre-registered (`mem-off` vs `mem-on`, 100 trials) | `/experiments/16da4716-6bd6-4a57-9adf-57f896874495` |
| v2, post-hoc with `write_file` (100 trials) | `/experiments/2189651f-4e58-4ec2-a9ac-bbf7892c7f1d` |
| Failed trial, with tool calls (`det_weekday_01`, memory on, ran out of budget) | `/trials/48bfc132-a2d7-450f-a693-6ea2d50b5a79` |
| Same task, memory off, passes in one step | `/trials/130863ef-d570-4fed-8851-7a0bd5996576` |
| Failed trial, no tool call (`mem_recall_client_01`, memory off) | `/trials/96057f98-a746-47f2-8749-0285abca65d1` |
| Passing trial that used memory (same task, memory on) | `/trials/34370d0c-31d7-483f-abfd-9ec30b423b10` |
| Judged trial with the judge's reasoning and a stored cost | `/trials/498322f3-af52-413b-bdf1-656301b8e334` |

Each path starts with `http://localhost:5174`.

**On a fresh stack** the IDs above do not exist. Run `npx tsx scripts/run-experiment.ts --name memory-ab --n 10 --configs mem-off,mem-on --tasks memory,control` (runbook §4.1, about 8 minutes, about $0.13), then pick trials by task and config from the experiment page: the `det_weekday_01` `mem-on` rows are the budget failures.

### 3.2 A small run for the cost columns

The Phase 14 runs have no stored cost, so their Compare page shows a dash for cost. For beat 4, run one small experiment beforehand with the current build (about $0.03):

- Tasks: `det_add_01`, `mem_recall_client_01`, `judge_summary_01`
- Configs: `mem-off` and `mem-on` (the Hermes configs from runbook §4.2)
- `nTrials`: 3, and name it `demo-cost`
- Start it and let it finish before you record.

### 3.3 Checklist

- [ ] Stack healthy: `docker compose -p p14 ps`
- [ ] Tabs open and in this order: `DESIGN.md` (preview), Configs, Experiments, v1 compare, v2 compare, `demo-cost` compare, the trial tabs from §3.1, `judge-validation.txt`, `LIMITS.md`, `packages/adapters-harness/src/registry.ts`, `packages/adapters-model/src/registry.ts`
- [ ] Browser zoom 110 to 125%, bookmarks bar hidden, notifications off
- [ ] Editor and terminal font large enough to read at 1080p
- [ ] `.env`, the OpenRouter dashboard, and any API key are not on screen
- [ ] One full dry run with a timer
- [ ] Numbers in §7 open on a second screen or paper

## 4. Script

Spoken pace is about 130 words a minute. Each block is sized for its slot. Say it in your own words, but keep the numbers.

### Beat 1: problem and architecture (0:00 to 0:40)

Screen: the diagram in `DESIGN.md` §1.

> "When you change an agent's model, prompt or memory, how do you know it got better? One run proves nothing, because agents are noisy. This platform compares two agent configurations on the same tasks, many trials each, in isolated sandboxes, and tells you whether the difference is real.
>
> A Vue UI talks to a NestJS API. Trials go through a Redis queue to a worker. The worker runs a harness, either a TypeScript baseline loop or Hermes Agent in a Python service, calls the model through OpenRouter, grades the result, and stores the trial and its full trace."

### Beat 2: configs A and B (0:40 to 1:50)

Screen: the Configs page.

- Point at the table: name, version, and the short content hash.
- Point at the two Hermes configs, `mem-off` and `mem-on`. Say they differ in one setting.
- Optionally, on the form, save a baseline config twice. The second save says "An identical config already exists … Nothing new was created."

> "A config is data: harness, model, temperature, memory, tools and budgets. It is immutable. Change any setting and you get a new version with a new content hash. Save the same thing twice and you get the same config back.
>
> Here are the two I compared. Same harness, Hermes. Same model, GPT-4.1 mini, temperature zero. Same tools and budgets. The only difference is whether memory is on. That is one axis, so any difference in the results comes from memory and its prompt."

### Beat 3: experiment, start, progress (1:50 to 3:00)

Screen: Experiments page, then the experiment page.

- Show the create form: name, hypothesis, tasks, configs, trials per cell. Do not create a long one live.
- Open the finished v1 experiment. Show the counts (100 succeeded), the trial table, and the **Start** button disabled because the run is complete.

> "An experiment is tasks times configs times N trials. I wrote the hypothesis down before running it: memory helps on tasks that need remembered facts, and does not change tasks that do not. Five tasks, two of them memory tasks and three controls, ten trials per cell, so a hundred trials.
>
> A run takes about eight minutes, so here is the finished one. Every trial is queued, retried if the infrastructure fails, and recorded as pass, fail or infrastructure failure. These are kept apart: an outage never counts as a wrong answer."

If you have time and a quick experiment: press **Start** on a 4-trial experiment and show the counts update every 3 seconds.

### Beat 4: compare (3:00 to 5:00)

Screen: Compare for v1 (A = `mem-on`, B = `mem-off`), then v2, then `demo-cost`.

**v1, about 55 seconds.**

- Verdict badge **Likely noise** and the badge "noise: the 95% interval includes 0".
- Macro pass rate 60.0% on each side.
- Difference 0.0 points, interval −60 to +60.
- Per-task table: `mem_recall_client_01` 10/10 against 0/10, `det_weekday_01` 0/10 against 10/10, `mem_deploy_file_01` 0/10 on both.

> "The result of the pre-registered run is noise. Memory-on and memory-off both score sixty percent, and the difference is zero, with an interval from minus sixty to plus sixty. The per-task table shows why. Memory takes the recall task from zero to ten out of ten. But on a control, the weekday question, memory-on fails ten out of ten and memory-off passes ten out of ten. The two effects cancel.
>
> The pass rate is averaged per task, and the interval resamples tasks, because trials of one task are not independent. McNemar's test is shown too, but it treats trials as independent, so I do not use it for the verdict."

**v2, about 35 seconds.**

- Verdict **A is better**, 80% against 20%, difference plus 60 points, interval +20 to +100.

> "After the first run I found a mistake in my own pre-registration. One memory task writes a file, and I had left the file tool out of both configs, so that task could never pass. I did not change the first result. I ran a second experiment, labelled post-hoc, with the file tool on in both arms. It reports memory as better.
>
> I would not trust that headline. Most of the gain is a control task that fails ten out of ten without memory, and the cause is the tool change, not memory. The answer depends on the tool setting, so neither run settles the question."

**Cost, latency, tokens, about 30 seconds.** Switch to `demo-cost`.

- Point at mean latency, mean tokens and mean cost on both sides.

> "Cost, latency and tokens sit next to quality. In the first run, memory-on cost about fourteen times as much per trial, because the memory tools add roughly four thousand prompt tokens to every call, even when nothing is read. Cost is an estimate at list price. I will come back to that."

### Beat 5: a failed trial (5:00 to 7:15)

Screen: Trial page for `48bfc132-…` (about 80 seconds), then the pair `96057f98-…` and `34370d0c-…` (about 55 seconds).

On the **weekday** trial (memory-on, failed):

1. **Outcome**: succeeded as a run, **not passed**. Say why: the harness ended on its budget.
2. **Trace**: five steps. Four `memory_read` calls (four tool calls, four tool results) with different queries, each returning no hit.
3. **Metrics**: 9,770 tokens against a budget of 8,000.
4. **Grader results**: `exact_match`, `expected=thursday got=` (nothing).
5. **Final answer**: empty.
6. Switch to `130863ef-…`: memory off, one step, 390 tokens, answer `Thursday`, grader `expected=thursday got=Thursday`.

> "This is a failed trial, and the trace says why. The question is what day of the week was the first of January 2026. The model could work that out, but with memory on it searched memory four times for the answer, got nothing every time, and ran out of budget. Nine thousand seven hundred tokens against a budget of eight thousand. The grader expected Thursday and got an empty answer. With memory off, the same model answers Thursday in one step, in under four hundred tokens.
>
> That is the cost of memory on a task that does not need it, and it explains the control drop in the compare table."

On the **mechanism pair** (`mem_recall_client_01`):

1. `96057f98-…` (memory off, failed): one step, no tool call, answer "No client ID found in memory." Grader expected `HL-2044`.
2. `34370d0c-…` (memory on, passed): a `memory_read` with the query "client id", the tool returns `client_id = HL-2044`, the answer is `HL-2044`.

> "And this is the effect the hypothesis predicted. Same task, same trial number. Without memory, the model has nothing and says so. With memory it reads the stored fact and answers correctly."

Optional, 15 seconds, if time: open the judged trial `498322f3-…` and show the judge's reasoning under Grader results and the stored cost in Metrics.

> "For judged tasks, the judge's reasoning is stored on the trial next to its score."

### Beat 6: judge validation and limits (7:15 to 8:10)

Screen: `judge-validation.txt`, then `LIMITS.md`.

> "LLM judges are only worth using if you measure them. I wrote twenty-five labelled answers across the five judged tasks and ran the judge on all of them. Agreement is ninety-two percent, twenty-three out of twenty-five, Cohen's kappa is zero point eight two six. There were two disagreements. I kept both and did not edit the rubric to fit them, because that would tune it on the validation set. I labelled them myself, one person, so this shows the judge matches these labels, not that it is calibrated in general.
>
> The limits are written down. Twenty-one tasks is small, and the memory experiment used five. At ten trials per cell, only about a sixty-point difference on a single task is detectable. Per-task deltas are exploratory. A trial that runs out of budget is recorded as a success with no answer, so I cannot report stop reasons. Cost is a list-price estimate: for the memory runs it is about thirty-nine cents, and the provider billed about nineteen, mostly from prompt caching. Those trials have no stored cost, because metering came after the runs. All of this is in LIMITS and COST."

### Beat 7: close (8:10 to 8:30)

Screen: `packages/adapters-harness/src/registry.ts` and `packages/adapters-model/src/registry.ts`, then `DESIGN.md` §2 and §3.

> "To add a harness, implement one interface, `run`, and register it in one switch. To add a model, add a price, and a new provider needs one adapter. The runner and the stats do not change. The code, the design document, the experiment write-up, the limits and the cost notes are all in the repo. Thanks for watching."

## 5. Screen cheat sheet

| Page | URL | Point at |
|---|---|---|
| Configs | `/configs` | Version and content-hash columns, the "immutable" text |
| Experiments | `/experiments` | The create form: hypothesis, tasks, configs, trials per cell |
| Experiment | `/experiments/:id` | Counts, trial table, **Compare configs** |
| Compare | `/experiments/:id/compare` | Verdict badge, noise badge, macro pass rate with interval, difference A minus B, p-value note, per-task table, mean latency, tokens, cost, the excluded counts |
| Trial | `/trials/:id` | Outcome, Metrics, Grader results, Agent's final answer, Trace timeline |

In Compare, set **A** to the memory-on config and **B** to the memory-off config. The delta is A minus B, so a positive number means memory helped. Config names in the `p14` stack: `mem-off`, `mem-on` (v1) and `mem-off-write_file`, `mem-on-write_file` (v2).

## 6. Say these things (they are scored as judgment)

1. **The pre-registered result is noise.** Say it as plainly as you would say a win.
2. **The pre-registration had a mistake.** The file tool was missing, so one memory task could not pass (0 of 20). The first result was left alone.
3. **v2 is post-hoc**, labelled as such, and most of its gain is a control that the tool change broke.
4. **The p-value is optimistic.** The verdict uses the interval over tasks.
5. **Cost is an estimate.** List price, not billed. About twice the billed amount for these runs, and not stored for the Phase 14 trials.
6. **The judge was checked on 25 labels from one labeller.**
7. **What is not done:** skills are not implemented in Hermes, `persistAcrossTrials` is stored but not implemented, sandboxes are directories and not containers, stop reasons are not exported, the API is not linked to Observe.

## 7. Numbers to have in front of you

| Item | Value |
|---|---|
| Tasks | 21 (12 deterministic, 5 judged, 4 discriminating) |
| Memory experiment | 5 tasks, 2 configs, N = 10, 100 trials, about 8 minutes |
| v1 (pre-registered) | 60.0% vs 60.0%, delta 0.0, interval [−60, +60], p = 1.0, `likely_noise` |
| v1 per task, memory-on vs memory-off | recall 10/10 vs 0/10; weekday 0/10 vs 10/10; deploy file 0/10 vs 0/10; add 10/10 vs 10/10; letter count 10/10 vs 10/10 |
| v2 (post-hoc, `write_file`) | 80% vs 20%, delta +60, interval [+20, +100], `a_better` |
| v2 floor | `det_add_01` memory-off 0/10 (file-write loops) |
| Judge | 25 labels, 92.0% agreement (23/25), κ 0.826, 2 disagreements, model `google/gemini-2.5-flash` |
| Bootstrap | 5,000 resamples over tasks, seed 1, 95% interval |
| Detectable at N = 10 | about 63 points on one task (80% power) |
| Cost, 204 trials | $0.39 list price, about $0.19 billed |
| Memory-on vs off, v1 | about 14 times the cost per trial (about 4,300 extra prompt tokens) |
| One judged trial | about $0.0007 |
| Tests | 262 TypeScript, 35 Python |

## 8. If something goes wrong

| Problem | Do this |
|---|---|
| The UI shows no data | `docker compose -p p14 ps`. If it is gone, use the saved files in `results/memory-ab/` (`compare.json`, `export.json`) and show the numbers there. Then say so on camera |
| A trial ID is missing | On the experiment page, filter the trial table by task `det_weekday_01` and config `mem-on` and open any failed row |
| Compare shows a dash for cost | Those trials predate metering. Switch to the `demo-cost` experiment |
| You run long | Cut beat 3, then the optional judged-trial detail in beat 5 |
| You stumble | Keep going. A clean take is not required. A wrong number is |

## 9. After recording

1. Upload as unlisted and check that it plays logged out.
2. Check the length is under 10:00.
3. Replace the line under **Video** in `README.md` ("Not recorded …") with the link.
4. Tick the last open box in `implementation.md` §28: "Video ≤10 min linked".

## 10. Do not claim

- That memory "works" or "does not work" in general. It is one model, one harness, two memory tasks.
- That v2 "proves" anything. It is post-hoc.
- That the McNemar p-value is a significance result.
- That cost figures are billed amounts.
- That the judge is calibrated beyond these 25 labels.
- That Hermes skills were tested. They were not run.
