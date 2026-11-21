import { describe, expect, it } from 'vitest';
import { resolveToolIds, TOOL_NAMES } from './tools';

const base = { tools: [...TOOL_NAMES], memoryEnabled: false, skillsEnabled: [] as string[] };

describe('resolveToolIds', () => {
  it('uses the config tools when the task does not narrow them', () => {
    expect(resolveToolIds(base)).toEqual(['write_file', 'read_file', 'list_dir']);
  });

  it('adds memory tools only when memory is enabled', () => {
    expect(resolveToolIds({ ...base, memoryEnabled: true })).toEqual(
      expect.arrayContaining(['memory_read', 'memory_write']),
    );
    expect(resolveToolIds(base)).not.toContain('memory_read');
  });

  it('adds the tools of each enabled skill', () => {
    expect(resolveToolIds({ ...base, skillsEnabled: ['csv_summary'] })).toContain('csv_summary');
    expect(resolveToolIds(base)).not.toContain('csv_summary');
  });

  it('lets a task narrow the list, but never widen it', () => {
    const narrowed = resolveToolIds({ ...base, memoryEnabled: true, skillsEnabled: ['csv_summary'] }, ['read_file', 'csv_summary']);
    expect(narrowed).toEqual(['read_file', 'csv_summary']);

    // memory tools are enabled by the config, but this task does not allow them
    expect(resolveToolIds(base, ['memory_read'])).toEqual([]);
  });

  it('rejects an unknown skill id so a config typo fails loudly', () => {
    expect(() => resolveToolIds({ ...base, skillsEnabled: ['csv_sumary'] })).toThrow(/unknown skill "csv_sumary"/);
  });

  it('does not repeat a tool id listed twice', () => {
    expect(resolveToolIds({ ...base, tools: ['read_file', 'read_file'] })).toEqual(['read_file']);
  });
});
