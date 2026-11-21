import { describe, expect, it } from 'vitest';
import { ScriptedModelAdapter } from './index';

describe('ScriptedModelAdapter', () => {
  const req = { messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0, maxTokens: 16 };
  const usage = { promptTokens: 1, completionTokens: 1 };

  it('replays responses in order and records requests', async () => {
    const m = new ScriptedModelAdapter([
      { message: { role: 'assistant', content: 'first' }, usage },
      { message: { role: 'assistant', content: 'second' }, usage },
    ]);
    expect((await m.complete('x', req)).message.content).toBe('first');
    expect((await m.complete('x', req)).message.content).toBe('second');
    expect(m.requests).toHaveLength(2);
  });

  it('throws when the script is exhausted', async () => {
    const m = new ScriptedModelAdapter([]);
    await expect(m.complete('x', req)).rejects.toThrow(/exhausted/);
  });
});
