import { describe, expect, it } from 'vitest';
import type { TrialView } from '../trials/trials.service.js';
import {
  csvEscape,
  experimentToCsv,
  TRIAL_EXPORT_COLUMNS,
  toCsv,
  trialExportRows,
  type ExportConfig,
} from './export.js';

const CONFIG_A: ExportConfig = {
  id: 'cfg-a',
  name: 'gpt-mini',
  version: 1,
  contentHash: 'h1',
  harnessId: 'baseline',
  provider: 'openrouter',
  modelId: 'openai/gpt-4.1-mini',
  temperature: 0,
};

const CONFIG_B: ExportConfig = {
  id: 'cfg-b',
  name: 'haiku',
  version: 1,
  contentHash: 'h2',
  harnessId: 'hermes',
  provider: 'openrouter',
  modelId: 'anthropic/claude-3.5-haiku',
  temperature: 0,
};

function trial(overrides: Partial<TrialView> = {}): TrialView {
  return {
    id: 't1',
    experimentId: 'exp-1',
    taskId: 'det_add_01',
    taskVersion: '1.0.0',
    configId: 'cfg-a',
    configContentHash: 'h1',
    trialIndex: 0,
    status: 'succeeded',
    seed: 1,
    score: 1,
    passed: true,
    metrics: { latencyMs: 1200, promptTokens: 148, completionTokens: 3, totalTokens: 151, stepCount: 1 },
    grade: null,
    error: null,
    traceUri: 'exp-1/t1.json',
    startedAt: new Date('2026-11-21T10:00:00.000Z'),
    finishedAt: new Date('2026-11-21T10:00:02.000Z'),
    hasTrace: true,
    ...overrides,
  } as TrialView;
}

describe('csvEscape', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(0)).toBe('0');
    expect(csvEscape(false)).toBe('false');
  });

  it('writes null and undefined as empty cells', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('quotes fields with commas, quotes or newlines, and doubles inner quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('prefixes text that starts with = + - @ so a spreadsheet reads it as text', () => {
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape('+1')).toBe("'+1");
    expect(csvEscape('-2')).toBe("'-2");
    expect(csvEscape('@cmd')).toBe("'@cmd");
  });

  it('does not prefix numbers that start with a minus sign', () => {
    expect(csvEscape(-2)).toBe('-2');
  });

  it('writes objects as JSON', () => {
    expect(csvEscape({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('toCsv', () => {
  it('writes the header, one line per row, and a trailing newline', () => {
    expect(toCsv(['a', 'b'], [{ a: 1, b: 'x' }, { a: 2 }])).toBe('a,b\n1,x\n2,\n');
  });
});

describe('trialExportRows', () => {
  it('adds the config name, harness and model to each trial row', () => {
    const [row] = trialExportRows([trial()], [CONFIG_A]);
    expect(row).toMatchObject({
      configName: 'gpt-mini',
      harnessId: 'baseline',
      modelId: 'openai/gpt-4.1-mini',
      stepCount: 1,
      totalTokens: 151,
    });
  });

  it('writes the start and finish times as ISO text, not as JSON-quoted values', () => {
    const [row] = trialExportRows([trial()], [CONFIG_A]);
    expect(row.startedAt).toBe('2026-11-21T10:00:00.000Z');
    expect(row.finishedAt).toBe('2026-11-21T10:00:02.000Z');
  });

  it('leaves the config columns blank when the config is not in the export', () => {
    const [row] = trialExportRows([trial({ configId: 'gone' })], [CONFIG_A]);
    expect(row.configName).toBeUndefined();
    expect(row.modelId).toBeUndefined();
  });

  it('leaves cost blank when the runner did not measure it', () => {
    const [row] = trialExportRows([trial()], [CONFIG_A]);
    expect(row.estimatedCostUsd).toBeUndefined();
  });

  it('puts the error code and message in their own columns', () => {
    const [row] = trialExportRows(
      [trial({ status: 'failed', error: { code: 'infra_error', message: 'worker down, retry', retryable: true } })],
      [CONFIG_A],
    );
    expect(row).toMatchObject({ errorCode: 'infra_error', errorMessage: 'worker down, retry' });
  });
});

describe('experimentToCsv', () => {
  it('starts with the documented header', () => {
    const csv = experimentToCsv({ experiment: {} as never, configs: [CONFIG_A], trials: [] });
    expect(csv).toBe(`${TRIAL_EXPORT_COLUMNS.join(',')}\n`);
  });

  it('keeps two configs with different models apart by their model column', () => {
    const csv = experimentToCsv({
      experiment: {} as never,
      configs: [CONFIG_A, CONFIG_B],
      trials: [trial(), trial({ id: 't2', configId: 'cfg-b' })],
    });
    const [header, rowA, rowB] = csv.trimEnd().split('\n');
    const cols = header!.split(',');
    const modelCol = cols.indexOf('modelId');
    expect(rowA!.split(',')[modelCol]).toBe('openai/gpt-4.1-mini');
    expect(rowB!.split(',')[modelCol]).toBe('anthropic/claude-3.5-haiku');
  });

  it('quotes an error message that contains a comma', () => {
    const csv = experimentToCsv({
      experiment: {} as never,
      configs: [CONFIG_A],
      trials: [trial({ error: { code: 'infra_error', message: 'a, b', retryable: true } })],
    });
    expect(csv).toContain('"a, b"');
  });
});
