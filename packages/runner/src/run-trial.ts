import type { GradeResult, Task, Trace } from '@agent-evals/domain';
import { createTrialMemory } from '@agent-evals/adapters-harness';
import type { HarnessAdapter, HarnessRunOutput } from '@agent-evals/adapters-harness';
import { createModelAdapter } from '@agent-evals/adapters-model';
import type { ModelAdapter } from '@agent-evals/adapters-model';
import { JudgeOutputError, exactMatch, getRubric, llmJudge, stateCheck, unitTest } from '@agent-evals/graders';
import { createSandbox, materializeFiles } from '@agent-evals/sandbox';
import type { Sandbox } from '@agent-evals/sandbox';
import { createTraceBuffer } from '@agent-evals/trace';

export interface TrialBudgets {
  maxSteps: number;
  maxTokens: number;
  /** Wall-clock limit for the whole trial. Enforced from outside the harness, so a hung model call is cut off too. */
  timeoutMs: number;
}

export interface RunTrialInput {
  trialId: string;
  task: Task;
  harness: HarnessAdapter;
  model: ModelAdapter;
  modelId: string;
  modelParams: { temperature: number; topP?: number };
  seed: number;
  budgets: TrialBudgets;
  /** Already resolved by the caller (e.g. config tools intersected with task.toolsAllowed). */
  toolIds: string[];
  /** Model used by llm_judge graders. Defaults to OpenRouter (needs OPENROUTER_API_KEY). Tests inject a scripted one. */
  judge?: ModelAdapter;
  /** Facts the trial's memory starts with (`task.setup.memory`). Unreachable unless a memory tool is in `toolIds`. */
  memorySeed?: Record<string, string>;
}

/**
 * Trial status (implementation.md §11.3):
 * - succeeded: the agent finished and graders ran. `passed` says whether the agent got it right.
 * - failed: infrastructure problem (model error, sandbox error, unsupported grader). Not the agent's fault.
 * - timeout: the trial exceeded its wall-clock budget.
 */
export type TrialStatus = 'succeeded' | 'failed' | 'timeout';

export interface TrialError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface RunTrialResult {
  status: TrialStatus;
  /** True only for a succeeded trial whose graders all passed. */
  passed: boolean;
  score: number;
  /** Present whenever graders ran (even if the trial failed afterwards). */
  grade: GradeResult | null;
  stoppedReason: HarnessRunOutput['stoppedReason'] | null;
  finalAnswer: string;
  metrics: {
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    stepCount: number;
  };
  error: TrialError | null;
  trace: Trace;
}

/** Errors the runner raises on purpose. `code` and `retryable` flow into the trial's error field. */
export class RunnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}

const TIMED_OUT = Symbol('timed-out');

/** Runs one trial: fresh sandbox, harness, graders, cleanup. Never throws for trial-level problems. */
export async function runTrial(input: RunTrialInput): Promise<RunTrialResult> {
  const trace = createTraceBuffer();
  const startedAt = Date.now();

  let status: TrialStatus = 'failed';
  let error: TrialError | null = null;
  let output: HarnessRunOutput | null = null;
  let grade: GradeResult | null = null;
  let sandbox: Sandbox | undefined;

  try {
    sandbox = await createSandbox(input.trialId);
    await materializeFiles(sandbox.dir, input.task.setup?.files);

    const ran = await withTimeout(
      input.harness.run({
        task: input.task,
        model: input.model,
        modelId: input.modelId,
        modelParams: input.modelParams,
        context: {
          trialId: input.trialId,
          seed: input.seed,
          sandboxDir: sandbox.dir,
          budgets: input.budgets,
          memory: createTrialMemory(input.memorySeed),
          skillIds: [],
          toolIds: input.toolIds,
          emit: trace.emit,
        },
      }),
      input.budgets.timeoutMs,
    );

    if (ran === TIMED_OUT) {
      status = 'timeout';
      error = { code: 'timeout', message: `trial exceeded ${input.budgets.timeoutMs} ms`, retryable: false };
    } else {
      output = ran;
      // Graders run before cleanup: state checks read the sandbox.
      grade = await gradeTask(input.task, output.finalAnswer, sandbox.dir, input.judge);

      if (output.stoppedReason === 'error') {
        status = 'failed';
        error = {
          code: 'model_error',
          message: lastErrorMessage(trace.snapshot()) ?? 'harness stopped with an error',
          retryable: true,
        };
      } else if (output.stoppedReason === 'timeout') {
        status = 'timeout';
        error = { code: 'timeout', message: 'harness stopped at its time budget', retryable: false };
      } else {
        status = 'succeeded';
      }
    }
  } catch (err) {
    status = 'failed';
    error = toTrialError(err);
  } finally {
    // Cleanup errors must not hide the trial's own outcome.
    await sandbox?.cleanup().catch(() => {});
  }

  const passed = status === 'succeeded' && grade?.passed === true;
  const promptTokens = output?.usage.promptTokens ?? 0;
  const completionTokens = output?.usage.completionTokens ?? 0;

  return {
    status,
    passed,
    score: status === 'succeeded' && grade ? grade.score : 0,
    grade,
    stoppedReason: output?.stoppedReason ?? null,
    finalAnswer: output?.finalAnswer ?? '',
    metrics: {
      latencyMs: Date.now() - startedAt,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      stepCount: output?.stepCount ?? 0,
    },
    error,
    trace: {
      trialId: input.trialId,
      events: trace.snapshot(),
      ...(output ? { finalAnswer: output.finalAnswer } : {}),
    },
  };
}

async function gradeTask(
  task: Task,
  finalAnswer: string,
  sandboxDir: string,
  judge: ModelAdapter | undefined,
): Promise<GradeResult> {
  const graderResults: GradeResult['graderResults'] = [];
  for (const g of task.graders) {
    if (g.type === 'exact_match') {
      const r = exactMatch(finalAnswer, g.expected, g.normalize);
      graderResults.push({ graderType: g.type, passed: r.passed, score: r.score, reasoning: r.reasoning });
    } else if (g.type === 'state_check') {
      const r = await stateCheck(sandboxDir, g.checks);
      graderResults.push({
        graderType: g.type,
        passed: r.passed,
        score: r.score,
        reasoning: r.reasoning,
        details: { checks: r.details },
      });
    } else if (g.type === 'unit_test') {
      const r = await unitTest(sandboxDir, g.command, g.timeoutMs);
      graderResults.push({
        graderType: g.type,
        passed: r.passed,
        score: r.score,
        reasoning: r.reasoning,
        details: { exitCode: r.exitCode, timedOut: r.timedOut, output: r.output },
      });
    } else if (g.type === 'llm_judge') {
      const rubric = getRubric(g.rubricId);
      if (!rubric) throw new RunnerError('rubric_not_found', `no rubric "${g.rubricId}"`);
      try {
        const r = await llmJudge({
          rubric,
          passThreshold: g.passThreshold,
          taskPrompt: task.prompt,
          answer: finalAnswer,
          model: judge ?? createModelAdapter('openrouter'),
          modelId: g.judgeModel,
        });
        graderResults.push({
          graderType: g.type,
          passed: r.passed,
          score: r.score,
          reasoning: r.reasoning,
          details: {
            rubricId: r.rubricId,
            judgeModel: r.judgeModel,
            scores: r.scores,
            failedRequired: r.failedRequired,
            attempts: r.attempts,
            usage: r.usage,
          },
        });
      } catch (err) {
        // Still malformed after the retry: not the agent's fault, and re-running the trial would not change the judge.
        if (err instanceof JudgeOutputError) throw new RunnerError('judge_invalid_output', err.message, false);
        throw err;
      }
    } else {
      const unknownGrader: never = g;
      throw new RunnerError('grader_not_implemented', `unknown grader ${JSON.stringify(unknownGrader)}`);
    }
  }
  const passed = graderResults.every((r) => r.passed);
  return { passed, score: passed ? 1 : 0, graderResults, aggregatePolicy: 'all_must_pass' };
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    // Promise.race subscribes to `work`, so a late rejection after the timeout is handled, not unhandled.
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function lastErrorMessage(events: Trace['events']): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'error') return e.message;
  }
  return undefined;
}

function toTrialError(err: unknown): TrialError {
  if (err instanceof RunnerError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'infra_error', message, retryable: true };
}
