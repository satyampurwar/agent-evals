/**
 * Deterministic JSON hashing used for content-addressed Task/Config rows.
 *
 * Problem: `{a:1,b:2}` and `{b:2,a:1}` are the same config but different JSON strings,
 * so a naive SHA-256 would produce different hashes. `sortKeysDeep` normalizes key order
 * first; `contentHash` then hashes that canonical string.
 *
 * Used by TasksService.import and ConfigsService.create (and expand-matrix seeds).
 */
import { createHash } from 'node:crypto';

/**
 * Returns a copy of `value` with object keys sorted recursively and `undefined` properties dropped
 * (matching JSON.stringify semantics). Arrays keep their order.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) {
        out[key] = sortKeysDeep(source[key]);
      }
    }
    return out;
  }
  return value;
}

/** Stable JSON text: same logical content always produces the same string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Content hash of a value, independent of key order. */
export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
