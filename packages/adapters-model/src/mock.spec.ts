import { describe, expect, it } from 'vitest';
import { MockModelAdapter } from './index';

describe('MockModelAdapter', () => {
  const req = {
    messages: [{ role: 'user' as const, content: 'hi' }],
    temperature: 0,
    maxTokens: 16,
  };

  it('returns 42 by default with usage', async () => {
    const res = await new MockModelAdapter().complete('mock/any', req);
    expect(res.message).toEqual({ role: 'assistant', content: '42' });
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 2 });
  });

  it('returns a configured response', async () => {
    const res = await new MockModelAdapter('43').complete('mock/any', req);
    expect(res.message.content).toBe('43');
  });
});
