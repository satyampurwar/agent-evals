import type { ChatMessage, ModelResponse } from '@agent-evals/adapters-model';
import { executeTool, specsFor } from './tools.js';
import type {
  HarnessAdapter,
  HarnessRunInput,
  HarnessRunOutput,
} from './types.js';

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
        const out = await executeTool(sandboxDir, call);
        emit({ ts: now(), type: 'tool_result', callId: call.id, ok: out.ok, result: out.result });
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
