import { describe, expect, it } from 'vitest';
import { createTrialMemory } from './memory';

describe('createTrialMemory', () => {
  it('starts with the seeded facts', async () => {
    const m = createTrialMemory({ client_id: 'HL-2044' });
    expect(await m.read('client id')).toEqual([{ key: 'client_id', value: 'HL-2044' }]);
  });

  it('matches every query word against the key or value, ignoring case and punctuation', async () => {
    const m = createTrialMemory({ deploy_region: 'eu-west-2', deploy_owner: 'ops-team-b' });
    expect(await m.read('DEPLOY region')).toEqual([{ key: 'deploy_region', value: 'eu-west-2' }]);
    expect(await m.read('owner')).toEqual([{ key: 'deploy_owner', value: 'ops-team-b' }]);
  });

  it('does not match a word inside a longer word', async () => {
    const m = createTrialMemory({ paid_flag: 'yes' });
    expect(await m.read('id')).toEqual([]);
  });

  it('returns everything for an empty query', async () => {
    const m = createTrialMemory({ a: '1', b: '2' });
    expect(await m.read('')).toHaveLength(2);
  });

  it('writes are visible to later reads, and overwrite the same key', async () => {
    const m = createTrialMemory();
    await m.write('color', 'blue');
    await m.write('color', 'green');
    expect(await m.read('color')).toEqual([{ key: 'color', value: 'green' }]);
  });

  it('keeps separate stores separate (no shared state between trials)', async () => {
    await createTrialMemory().write('secret', 'x');
    expect(await createTrialMemory().read('secret')).toEqual([]);
  });
});
