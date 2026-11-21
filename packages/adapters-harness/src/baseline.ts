import type { ChatMessage, ModelResponse, ToolCall } from '@agent-evals/adapters-model';
import type { TraceEvent } from '@agent-evals/domain';
import { executeTool, isSkillTool, specsFor } from './tools.js';
import type { ToolOutcome } from './tools.js';
import type {
  HarnessAdapter,
  HarnessRunInput,
  HarnessRunOutput,
} from './types.js';

/**
 * Extra trace events for memory and skill tools, on top of the generic tool_call / tool_result pair.
 * Only successful calls are recorded: a failed memory write did not change the store.
 */
function emitDerivedEvent(
  call: ToolCall,
  out: ToolOutcome,
  emit: (event: TraceEvent) => void,
  ts: string,
): void {
  if (!out.ok) return;
  const args = call.arguments ?? {};
  if (call.name === 'memory_read') {
    const hits = (out.result as { hits?: unknown[] }).hits ?? [];
    emit({ ts, type: 'memory_read', query: String(args.query ?? ''), hits });
  } else if (call.name === 'memory_write') {
    emit({ ts, type: 'memory_write', key: String(args.key ?? ''), value: args.value });
  } else if (isSkillTool(call.name)) {
    emit({ ts, type: 'skill_invoke', skillId: call.name, input: args });
  }
}

/**
 * Baseline tool-calling loop:
 *  1. user prompt -> model
 *  2. if the model returns tool calls, run them in the sandbox, feed results back, go to 1
 *  3. stop when the model answers without tool calls, or a budget is hit
 *
 * Budgets: `maxSteps` caps model calls, `maxTokens` caps total tokens across the trial
 * (and is also sent as each request's completion cap), `timeoutMs` caps wall time.
 */
export class BaselineHarness implements HarnessAdapter {
  readonly id = 'baseline';
  readonly displayName = 'Baseline tool-calling loop';

  async run(input: HarnessRunInput): Promise<HarnessRunOutput> {
    const { task, model, modelId, modelParams, context } = input;
    const { budgets, emit, sandboxDir } = context;
    const now = () => new Date().toISOString();
    const startedAt = Date.now();
    const tools = specsFor(context.toolIds);

    const usage = { promptTokens: 0, completionTokens: 0 };
    let finalAnswer = '';
    let step = 0;

    const finish = (stoppedReason: HarnessRunOutput['stoppedReason']): HarnessRunOutput => ({
      finalAnswer,
      stoppedReason,
      usage,
      stepCount: step,
    });

    const messages: ChatMessage[] = [{ role: 'user', content: task.prompt }];
    emit({ ts: now(), type: 'step_boundary', step: 1 });
    emit({ ts: now(), type: 'message', role: 'user', content: task.prompt });

    for (;;) {
      if (step >= budgets.maxSteps) return finish('max_steps');
      if (Date.now() - startedAt > budgets.timeoutMs) return finish('timeout');

      step += 1;
      if (step > 1) emit({ ts: now(), type: 'step_boundary', step });

      let res: ModelResponse;
      try {
        res = await model.complete(modelId, {
          messages,
          tools: tools.length > 0 ? tools : undefined,
          temperature: modelParams.temperature,
          maxTokens: budgets.maxTokens,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ ts: now(), type: 'error', message, code: 'model_error' });
        return finish('error');
      }

      usage.promptTokens += res.usage.promptTokens;
      usage.completionTokens += res.usage.completionTokens;
      finalAnswer = res.message.content;
      emit({ ts: now(), type: 'message', role: 'assistant', content: res.message.content });

      const calls = res.message.toolCalls ?? [];
      messages.push({
        role: 'assistant',
        content: res.message.content,
        toolCalls: calls.length > 0 ? calls : undefined,
      });

      if (calls.length === 0) return finish('completed');

      if (usage.promptTokens + usage.completionTokens > budgets.maxTokens) {
        return finish('max_tokens');
      }

      for (const call of calls) {
        emit({ ts: now(), type: 'tool_call', name: call.name, args: call.arguments, callId: call.id });
        // The model can name any tool; only the tools this trial was offered may run.
        const out = context.toolIds.includes(call.name)
          ? await executeTool(sandboxDir, call, context.memory)
          : { ok: false, result: { error: `tool not available in this trial: ${call.name}` } };
        emit({ ts: now(), type: 'tool_result', callId: call.id, ok: out.ok, result: out.result });
        emitDerivedEvent(call, out, emit, now());
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(out.result),
        });
      }
    }
  }
}
