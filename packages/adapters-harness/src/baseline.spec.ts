import { describe, expect, it } from 'vitest';
import { TaskSchema } from '@agent-evals/domain';
import type { TraceEvent } from '@agent-evals/domain';
import { MockModelAdapter } from '@agent-evals/adapters-model';
import { BaselineHarness, noopMemory } from './index';

describe('BaselineHarness', () => {
  const task = TaskSchema.parse({
    id: 't',
    version: '1.0.0',
    name: 'n',
    description: 'd',
    prompt: 'What is 17 + 25?',
    graders: [],
    tags: [],
  });

  it('emits user + assistant messages and returns the final answer', async () => {
    const events: TraceEvent[] = [];
    const out = await new BaselineHarness().run({
      task,
      model: new MockModelAdapter('42'),
      modelId: 'mock/any',
      modelParams: { temperature: 0 },
      context: {
        trialId: 'trial-1',
        seed: 0,
        sandboxDir: '/tmp/unused',
        budgets: { maxSteps: 1, maxTokens: 64, timeoutMs: 1000 },
        memory: noopMemory,
        skillIds: [],
        toolIds: [],
        emit: (e) => events.push(e),
      },
    });

    expect(out).toMatchObject({ finalAnswer: '42', stoppedReason: 'completed', stepCount: 1 });
    const messages = events.filter((e) => e.type === 'message');
    expect(messages).toMatchObject([
      { role: 'user', content: 'What is 17 + 25?' },
      { role: 'assistant', content: '42' },
    ]);
  });
});
