import { describe, expect, it } from 'vitest';
import type { Trace } from '@agent-evals/domain';
import { createTraceBuffer, deserializeTrace, serializeTrace } from './index';

describe('createTraceBuffer', () => {
  it('collects emitted events in order', () => {
    const buf = createTraceBuffer();
    buf.emit({ ts: 't1', type: 'step_boundary', step: 1 });
    buf.emit({ ts: 't2', type: 'message', role: 'user', content: 'hi' });

    expect(buf.events.map((e) => e.type)).toEqual(['step_boundary', 'message']);
  });

  it('snapshot is isolated from later emits', () => {
    const buf = createTraceBuffer();
    buf.emit({ ts: 't1', type: 'step_boundary', step: 1 });
    const snap = buf.snapshot();
    buf.emit({ ts: 't2', type: 'step_boundary', step: 2 });

    expect(snap).toHaveLength(1);
    expect(buf.events).toHaveLength(2);
  });
});

describe('trace serialization', () => {
  const trace: Trace = {
    trialId: 'trial-1',
    events: [
      { ts: 't1', type: 'message', role: 'user', content: 'What is 17 + 25?' },
      { ts: 't2', type: 'message', role: 'assistant', content: '42' },
    ],
    finalAnswer: '42',
  };

  it('round-trips', () => {
    expect(deserializeTrace(serializeTrace(trace))).toEqual(trace);
  });

  it('rejects a malformed trace', () => {
    expect(() =>
      deserializeTrace(JSON.stringify({ trialId: 'x', events: [{ type: 'nope' }] })),
    ).toThrow();
  });
});
