import { describe, expect, it } from 'vitest';
import { exactMatch } from './index';

describe('exactMatch', () => {
  it('passes when whitespace differs (trim_lower)', () => {
    const r = exactMatch(' 42 ', '42');
    expect(r).toMatchObject({ passed: true, score: 1 });
  });

  it('is case-insensitive under trim_lower', () => {
    expect(exactMatch('Paris', 'paris').passed).toBe(true);
  });

  it('fails on a different answer', () => {
    const r = exactMatch('42', '43');
    expect(r).toMatchObject({ passed: false, score: 0 });
    expect(r.reasoning).toBe('expected=43 got=42');
  });

  it('defaults to trim_lower when normalize is omitted', () => {
    expect(exactMatch(' 42 ', '42', undefined).passed).toBe(true);
  });
});
