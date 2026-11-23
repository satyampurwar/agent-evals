/**
 * `@agent-evals/graders` — pass/fail scorers run after a trial's harness finishes.
 *
 * The runner invokes one function per entry in `task.graders`. All must pass today
 * (`all_must_pass`). Rubrics for the LLM judge live here too.
 *
 * | Grader        | Checks                                              |
 * |---------------|-----------------------------------------------------|
 * | exact_match   | final answer string equals expected (optional norm) |
 * | state_check   | files in the sandbox exist / equal / JSON path      |
 * | unit_test     | shell command exits 0 inside the sandbox            |
 * | llm_judge     | another LLM scores the answer against a rubric      |
 */
export { exactMatch } from './exact-match.js';
export type { GraderOutcome } from './exact-match.js';
export { stateCheck } from './state-check.js';
export type { StateCheckDetail, StateCheckOutcome } from './state-check.js';
export { unitTest } from './unit-test.js';
export type { UnitTestOutcome } from './unit-test.js';
export { getRubric, listRubricIds } from './rubrics.js';
export type { Rubric, RubricCriterion } from './rubrics.js';
export { JudgeOutputError, MET_AT, buildJudgePrompt, llmJudge, parseJudgeOutput, scoreRubric } from './llm-judge.js';
export type { LlmJudgeOptions, LlmJudgeOutcome, RubricScore } from './llm-judge.js';
