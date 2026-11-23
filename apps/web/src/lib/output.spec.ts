import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@agent-evals/domain';
import type { TrialView } from '../api/endpoints';
import { csvEscape, toCsv, trialCsvRows, TRIAL_CSV_COLUMNS } from './csv';
import { interval, pct, pts, pValue, usd, ms } from './format';
import { timeline } from './trace';
import { isScored, outcomeOf } from './trial';

describe('csvEscape', () => {
  it('quotes fields with commas, quotes and newlines, doubling inner quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('writes null and undefined as empty cells', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('neutralises spreadsheet formulas in text, but not in numbers', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('+1')).toBe("'+1");
    expect(csvEscape('@cmd')).toBe("'@cmd");
    expect(csvEscape(-0.5)).toBe('-0.5');
  });

  it('writes booleans and objects as text', () => {
    expect(csvEscape(true)).toBe('true');
    expect(csvEscape({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('toCsv and trialCsvRows', () => {
  it('writes a header and one line per row, in column order', () => {
    expect(toCsv(['a', 'b'], [{ a: 1, b: 'x' }, { a: 2, b: null }])).toBe('a,b\n1,x\n2,\n');
  });

  it('exports one row per trial with the metrics that exist and blanks for the rest', () => {
    const trial = {
      experimentId: 'e',
      taskId: 't',
      taskVersion: '1.0.0',
      configId: 'c',
      trialIndex: 0,
      status: 'succeeded',
      passed: false,
      score: 0,
      metrics: { latencyMs: 120, totalTokens: 40 },
      error: null,
      startedAt: null,
      finishedAt: null,
    } as unknown as TrialView;
    const [row] = trialCsvRows([trial]);
    const line = toCsv(TRIAL_CSV_COLUMNS, [row!]).split('\n')[1];
    // status, stoppedReason, passed, score, latency, tokens, judgePrompt, judgeCompletion, cost, errorCode, errorMessage, started, finished
    expect(line).toBe('e,t,1.0.0,c,0,succeeded,,false,0,120,40,,,,,,,');
  });
});

describe('format', () => {
  it('shows missing values as a dash, never as zero', () => {
    expect(pct(null)).toBe('—');
    expect(usd(null)).toBe('—');
    expect(ms(null)).toBe('—');
    expect(pct(0)).toBe('0%');
  });

  it('formats deltas and intervals', () => {
    expect(pts(0.75)).toBe('+75 pts');
    expect(pts(-0.1)).toBe('-10 pts');
    expect(interval({ low: 0.35, high: 1 })).toBe('[0.35, 1.00]');
    expect(interval(null)).toBe('n/a');
    expect(pValue(0.00006)).toBe('< 0.0001');
    expect(pValue(0.2529)).toBe('0.2529');
  });
});

describe('timeline', () => {
  const events: TraceEvent[] = [
    { ts: '2026-01-01T00:00:00.000Z', type: 'message', role: 'user', content: 'hi' },
    { ts: '2026-01-01T00:00:01.500Z', type: 'tool_call', name: 'read_file', args: { path: 'a' }, callId: 'c1' },
    { ts: '2026-01-01T00:00:02.000Z', type: 'tool_result', callId: 'c1', ok: false, result: 'nope' },
    { ts: '2026-01-01T00:00:03.000Z', type: 'error', message: 'boom', code: 'model_error' },
  ];

  it('keeps event order and offsets from the first event', () => {
    const rows = timeline(events);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r.offsetMs)).toEqual([0, 1500, 2000, 3000]);
  });

  it('labels refused tool results as errors and tool calls by name', () => {
    const rows = timeline(events);
    expect(rows[1]!.label).toBe('tool call: read_file');
    expect(rows[2]!.tone).toBe('error');
    expect(rows[2]!.label).toBe('tool result (refused or failed)');
    expect(rows[3]!.label).toBe('error (model_error)');
  });

  it('gives a null offset when a timestamp does not parse', () => {
    const rows = timeline([{ ts: 'not a date', type: 'step_boundary', step: 1 }]);
    expect(rows[0]!.offsetMs).toBeNull();
  });

  it('clips very long content and says how long it was', () => {
    const long = 'x'.repeat(2000);
    const [row] = timeline([{ ts: '2026-01-01T00:00:00.000Z', type: 'message', role: 'assistant', content: long }]);
    expect(row!.detail.startsWith('x'.repeat(1200))).toBe(true);
    expect(row!.detail).toMatch(/2000 chars/);
  });
});

describe('outcomeOf', () => {
  it('separates scored failures from infrastructure failures', () => {
    expect(outcomeOf({ status: 'succeeded', passed: true })).toBe('passed');
    expect(outcomeOf({ status: 'succeeded', passed: false })).toBe('failed');
    expect(outcomeOf({ status: 'failed', passed: false })).toBe('infra');
    expect(outcomeOf({ status: 'timeout', passed: false })).toBe('timeout');
    expect(outcomeOf({ status: 'queued', passed: null })).toBe('pending');
  });

  it('counts a succeeded or timed-out trial as scored, and nothing else', () => {
    expect(isScored({ status: 'succeeded' })).toBe(true);
    expect(isScored({ status: 'timeout' })).toBe(true);
    expect(isScored({ status: 'failed' })).toBe(false);
  });
});
