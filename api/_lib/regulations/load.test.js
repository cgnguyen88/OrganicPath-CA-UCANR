import { describe, it, expect, vi } from 'vitest';
import { loadChunks } from './load.js';

const row = (n) => ({ citation: `7 CFR 205.${n}`, version_date: '2026-10-08' });
const fakeClient = (results = []) => {
  const upserts = [];
  const queue = [...results];
  return {
    upserts,
    from: vi.fn((table) => ({
      upsert: async (batch, options) => { upserts.push({ table, batch, options }); return queue.shift() ?? { error: null }; },
    })),
  };
};

describe('loadChunks', () => {
  it('upserts in batches, keyed on citation + version so a re-run replaces instead of duplicating', async () => {
    const client = fakeClient();
    const total = await loadChunks(client, Array.from({ length: 5 }, (_, i) => row(i)), { batchSize: 2 });
    expect(total).toBe(5);
    expect(client.upserts.map((u) => u.batch.length)).toEqual([2, 2, 1]);
    expect(client.upserts[0]).toMatchObject({ table: 'regulation_chunks', options: { onConflict: 'citation,version_date' } });
  });

  it('stops and reports where it failed', async () => {
    const client = fakeClient([{ error: null }, { error: { message: 'permission denied' } }]);
    await expect(loadChunks(client, Array.from({ length: 6 }, (_, i) => row(i)), { batchSize: 2 })).rejects.toThrow(/after 2 of 6.*permission denied/s);
    expect(client.upserts).toHaveLength(2);
  });

  it('refuses to load nothing', async () => {
    await expect(loadChunks(fakeClient(), [], {})).rejects.toThrow(/no chunks/i);
  });
});
