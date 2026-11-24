# Known limits

Where the platform’s conclusions should **not** be trusted. Each point is tied to this repo or to the full-catalog memory A/B in [EXPERIMENT.md](EXPERIMENT.md).

## 1. Task-set size

The catalog has **21 tasks** (12 deterministic, 5 LLM-judged, 4 discriminating). That is enough to exercise graders and adapters. It is not a representative production suite and cannot rank agents in general.

The scored experiment used the **full 21-task catalog** at **N = 3**. Macro pass rates were high on both arms, so the bootstrap CI on Δ still touched **0** (`likely_noise`) even though McNemar on discordant pairs was small.

**Statistical power.** With N = 3 per arm, only very large per-task effects (~full pass/fail swings) are clear in the per-task table. A `likely_noise` verdict means “not distinguishable from zero under this design,” not “there is no effect.”

**Multiple comparisons.** Per-task deltas are exploratory and unadjusted. Reading twenty-one of them as separate significance tests would inflate error rates. Do not treat them as confirmatory.

## 2. Judge bias

- Agreement was measured on **25 human labels** (5 tasks × 5 labels; 9 pass / 16 fail), not on a population: **92% agreement, Cohen’s κ = 0.826** ([`judge-validation.txt`](../judge-validation.txt)). The uncertainty on κ at n = 25 is wide.
- Labels are from **one person** — no inter-rater baseline.
- Two disagreements were kept; rubrics were **not** edited to fit the validation set (that would overfit).
- **Not measured:** verbosity preference, family self-preference, or rubric gaming. The judge (`google/gemini-2.5-flash`) differs from the agent (`openai/gpt-4.1-mini`), which reduces self-preference risk but does not measure it.

These numbers show the judge agrees with this label set. They do not show the judge is calibrated on other answers or tasks.

## 3. Contamination

Tasks and memory facts were written for this project (e.g. `client_id = HL-2044`), so the model cannot answer memory items from training data alone. Judge rubrics and some wording may still resemble public material. **Contamination was not tested** (no held-out or perturbed variants). Prefer novel local fixtures for any claim beyond this set.

**Tool scope.** Scored tasks have no live web or external APIs — only sandbox tools (`memory_*`, file tools, `csv_summary`). Results say nothing about agents that depend on search or third-party services.

## 4. Harness-specific quirks

Results are tied to the harness under test; they do not transfer automatically to another loop.

- **Hermes tool loops.** With `csv_summary` enabled on every arm, non-skill controls (`det_weekday_01`, some `det_add_01` / `det_letter_count_01` trials) called the skill with bad paths and burned the step/token budget ([EXPERIMENT.md](EXPERIMENT.md) trajectories).
- **Skill scope leaks into controls.** Exact-match tasks that ask for “only the number” can fail after a failed skill call produces a verbose sentence instead of `4`.
- **Memory-on is not “memory content alone.”** Enabling memory adds memory tools (and their prompt surface) even when the task never needs them. Mean tokens were ~5k/trial on both arms in the full-catalog run.
- **Skills on Hermes.** `csv_summary` is exposed as a tool in this stack; enabling it for the full catalog is a toolset choice, not a pure memory ablation.
- **No cross-trial memory.** `persistAcrossTrials: true` is rejected; each trial starts from `task.setup.memory` only.
- **Isolation is host temp dirs, not containers.** Path checks block escapes, but the Hermes worker is one shared process; conclusions assume the allow-listed toolset and do not claim full process isolation.
- **`claude-agent` is only dependable on Anthropic models.** The harness runs Claude Code and points it at OpenRouter’s Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`), with the config’s OpenRouter model id used as is and every Claude Code model role pinned to it. OpenRouter only guarantees this for Anthropic models, and only on Anthropic’s own provider. Other models are best effort: tool calling may behave differently, so a lower score may reflect the harness and not the model. Provider routing is not pinned either, so the same Anthropic model can be served by a different provider (a trial run during development was served through Amazon Bedrock). Compare models on `baseline` or `hermes`; use `claude-agent` for Anthropic models only.
- **Provider / model drift.** Model ids are not date-pinned (`openai/gpt-4.1-mini` is whatever OpenRouter routes today). `temperature` 0 is not treated as determinism; that is why comparisons use N trials and intervals, not a single run.
