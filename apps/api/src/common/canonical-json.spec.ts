import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, sortKeysDeep } from './canonical-json.js';

describe('canonicalJson', () => {
  it('produces the same text regardless of key order, at every depth', () => {
    const a = { b: 1, a: { y: [{ d: 1, c: 2 }], x: true } };
    const b = { a: { x: true, y: [{ c: 2, d: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"x":true,"y":[{"c":2,"d":1}]},"b":1}');
  });

  it('keeps array order (arrays are ordered data)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined properties, as JSON.stringify does', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('contentHash', () => {
  const config = {
    name: 'baseline',
    harness: { id: 'baseline', settings: { tools: ['read_file'], maxSteps: 8 } },
    model: { provider: 'openrouter', modelId: 'openai/gpt-4.1-mini', temperature: 0.2 },
  };

  it('is stable across key reordering', () => {
    const reordered = {
      model: { temperature: 0.2, modelId: 'openai/gpt-4.1-mini', provider: 'openrouter' },
      harness: { settings: { maxSteps: 8, tools: ['read_file'] }, id: 'baseline' },
      name: 'baseline',
    };
    expect(contentHash(reordered)).toBe(contentHash(config));
  });

  it('changes when a single setting changes (temperature 0.2 -> 0.3)', () => {
    const hotter = { ...config, model: { ...config.model, temperature: 0.3 } };
    expect(contentHash(hotter)).not.toBe(contentHash(config));
  });

  it('returns a 64-char lowercase hex sha256', () => {
    expect(contentHash(config)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sortKeysDeep', () => {
  it('does not mutate its input', () => {
    const input = { b: 1, a: 2 };
    sortKeysDeep(input);
    expect(Object.keys(input)).toEqual(['b', 'a']);
  });
});
