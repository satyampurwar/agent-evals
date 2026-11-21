import type {
  HarnessAdapter,
  HarnessRunInput,
  HarnessRunOutput,
} from './types';

/**
 * Happy-path baseline: one user message, one model call (no tools yet),
 * one assistant message. Tool loop arrives in a later step.
 */
export class BaselineHarness implements HarnessAdapter {
  readonly id = 'baseline';
  readonly displayName = 'Baseline tool-calling loop';

  async run({ task, model, modelId, modelParams, context }: HarnessRunInput): Promise<HarnessRunOutput> {
    const now = () => new Date().toISOString();

    context.emit({ ts: now(), type: 'step_boundary', step: 1 });
    context.emit({ ts: now(), type: 'message', role: 'user', content: task.prompt });

    const res = await model.complete(modelId, {
      messages: [{ role: 'user', content: task.prompt }],
      temperature: modelParams.temperature,
      maxTokens: context.budgets.maxTokens,
    });

    context.emit({
      ts: now(),
      type: 'message',
      role: 'assistant',
      content: res.message.content,
    });

    return {
      finalAnswer: res.message.content,
      stoppedReason: 'completed',
      usage: res.usage,
      stepCount: 1,
    };
  }
}
