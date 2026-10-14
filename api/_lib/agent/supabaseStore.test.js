import { describe, it, expect, vi } from 'vitest';
import { createAgentStore } from './supabaseStore.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const HASH = 'a'.repeat(64);

/** A chainable, awaitable query double that records every call made on it. */
function fakeQuery(result) {
  const calls = [];
  const proxy = new Proxy(function noop() {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      return (...args) => { calls.push([prop, ...args]); return proxy; };
    },
  });
  return { query: proxy, calls };
}

/** createClient double: `results` maps a table name to the sequence of results its queries return. */
function harness(results = {}) {
  const clients = [];
  const queries = [];
  const createClientImpl = vi.fn((url, key, options) => {
    const client = { url, key, options, from: vi.fn((table) => {
      const queue = results[table] ?? [];
      const { query, calls } = fakeQuery(queue.length > 1 ? queue.shift() : queue[0] ?? { data: null, error: null });
      queries.push({ table, key, calls });
      return query;
    }) };
    clients.push(client);
    return client;
  });
  return { createClientImpl, clients, queries };
}

const has = (calls, name, ...args) => calls.some(([n, ...a]) => n === name && args.every((v, i) => JSON.stringify(a[i]) === JSON.stringify(v)));

describe('client construction', () => {
  it('acts as the caller: anon key plus the caller’s bearer token, no session storage', async () => {
    const h = harness({ farm_members: [{ data: [{ farm_id: 'f1', role: 'crew' }], error: null }] });
    await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).resolveMembership('tok', 'u1');
    const client = h.clients[0];
    expect(client.key).toBe('anon-key');
    expect(client.options.global.headers.Authorization).toBe('Bearer tok');
    expect(client.options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });

  it('uses the service-role key only to insert, and never for reads', async () => {
    const h = harness({ records: [{ data: [{ id: 'r1' }], error: null }], farm_members: [{ data: [], error: null }] });
    const store = createAgentStore(ENV, { createClientImpl: h.createClientImpl });
    await store.resolveMembership('tok', 'u1');
    await store.findCapture('tok', { farmId: 'f1', captureHash: HASH });
    await store.loadRecord('tok', 'r1');
    expect(h.queries.map((q) => q.key)).toEqual(['anon-key', 'anon-key', 'anon-key']);
    await store.insertRecords([{ kind: 'note' }]);
    expect(h.queries.at(-1).key).toBe('service-key');
    const service = h.clients.find((c) => c.key === 'service-key');
    expect(service.options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    expect(service.options.global).toBeUndefined(); // never carries a user's bearer token
  });

  it('refuses to insert when the service key is not configured', async () => {
    const h = harness();
    const { SUPABASE_SERVICE_ROLE_KEY: _drop, ...env } = ENV;
    await expect(createAgentStore(env, { createClientImpl: h.createClientImpl }).insertRecords([{}])).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(h.createClientImpl).not.toHaveBeenCalled();
  });

  it('refuses everything when Supabase is not configured', async () => {
    const h = harness();
    await expect(createAgentStore({}, { createClientImpl: h.createClientImpl }).resolveMembership('t', 'u')).rejects.toThrow(/SUPABASE_URL/);
  });

  it('accepts the VITE_ names for the public URL and anon key only', async () => {
    const h = harness({ farm_members: [{ data: [], error: null }] });
    await createAgentStore({ VITE_SUPABASE_URL: 'https://v.supabase.co', VITE_SUPABASE_ANON_KEY: 'vite-anon' }, { createClientImpl: h.createClientImpl }).resolveMembership('t', 'u');
    expect(h.clients[0]).toMatchObject({ url: 'https://v.supabase.co', key: 'vite-anon' });
  });
});

describe('resolveMembership', () => {
  it('returns the oldest membership of the user', async () => {
    const h = harness({ farm_members: [{ data: [{ farm_id: 'f1', role: 'owner' }], error: null }] });
    const result = await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).resolveMembership('tok', 'u1');
    expect(result).toEqual({ farmId: 'f1', role: 'owner' });
    const { calls } = h.queries[0];
    expect(has(calls, 'eq', 'user_id', 'u1')).toBe(true);
    expect(has(calls, 'order', 'created_at', { ascending: true })).toBe(true);
    expect(has(calls, 'limit', 1)).toBe(true);
  });

  it('returns null when the user has no farm and throws on a database error', async () => {
    const none = harness({ farm_members: [{ data: [], error: null }] });
    expect(await createAgentStore(ENV, { createClientImpl: none.createClientImpl }).resolveMembership('t', 'u')).toBeNull();
    const bad = harness({ farm_members: [{ data: null, error: { code: '500', message: 'boom' } }] });
    await expect(createAgentStore(ENV, { createClientImpl: bad.createClientImpl }).resolveMembership('t', 'u')).rejects.toThrow('boom');
  });
});

describe('findCapture', () => {
  it('looks up this farm’s records for the capture key', async () => {
    const h = harness({ records: [{ data: [{ id: 'r1' }], error: null }] });
    const rows = await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).findCapture('tok', { farmId: 'f1', captureHash: HASH });
    expect(rows).toEqual([{ id: 'r1' }]);
    const { calls } = h.queries[0];
    expect(has(calls, 'eq', 'farm_id', 'f1')).toBe(true);
    expect(has(calls, 'like', 'source_ref', `${HASH}#%`)).toBe(true);
  });

  it.each([['%'], ['abc'], [`${'a'.repeat(63)}%`], ['a'.repeat(64) + ',farm_id.neq.x']])('rejects a malformed key %j (no filter injection)', async (bad) => {
    const h = harness();
    await expect(createAgentStore(ENV, { createClientImpl: h.createClientImpl }).findCapture('t', { farmId: 'f', captureHash: bad })).rejects.toThrow(/capture key/i);
    expect(h.queries).toHaveLength(0);
  });
});

describe('insertRecords', () => {
  it('inserts the rows and returns what was stored', async () => {
    const h = harness({ records: [{ data: [{ id: 'r1', version: 1 }], error: null }] });
    const out = await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).insertRecords([{ kind: 'note' }]);
    expect(out).toEqual([{ id: 'r1', version: 1 }]);
    expect(has(h.queries[0].calls, 'insert', [{ kind: 'note' }])).toBe(true);
  });

  it('keeps the Postgres error code so the caller can recognise a duplicate', async () => {
    const h = harness({ records: [{ data: null, error: { code: '23505', message: 'duplicate key' } }] });
    await expect(createAgentStore(ENV, { createClientImpl: h.createClientImpl }).insertRecords([{}])).rejects.toMatchObject({ code: '23505' });
  });
});

describe('loadRecord', () => {
  it('returns the row, or null when row-level security hides it', async () => {
    const seen = harness({ records: [{ data: { id: 'r1' }, error: null }] });
    expect(await createAgentStore(ENV, { createClientImpl: seen.createClientImpl }).loadRecord('t', 'r1')).toEqual({ id: 'r1' });
    const hidden = harness({ records: [{ data: null, error: null }] });
    expect(await createAgentStore(ENV, { createClientImpl: hidden.createClientImpl }).loadRecord('t', 'r1')).toBeNull();
  });
});

describe('updateRecord', () => {
  const patch = { payload: { a: 1 }, status: 'pending_review' };

  it('updates only the matching id AND version, and returns the new row', async () => {
    const h = harness({ records: [{ data: [{ id: 'r1', version: 4 }], error: null }] });
    const out = await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).updateRecord('tok', 'r1', 3, patch);
    expect(out).toEqual({ ok: true, row: { id: 'r1', version: 4 } });
    const { calls } = h.queries[0];
    expect(has(calls, 'update', patch)).toBe(true);
    expect(has(calls, 'eq', 'id', 'r1')).toBe(true);
    expect(has(calls, 'eq', 'version', 3)).toBe(true);
    expect(h.queries[0].key).toBe('anon-key');
  });

  it('reports a conflict when someone else changed the record first', async () => {
    const h = harness({ records: [{ data: [], error: null }, { data: { id: 'r1', version: 5 }, error: null }] });
    expect(await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).updateRecord('t', 'r1', 3, patch)).toEqual({ ok: false, reason: 'conflict' });
  });

  it('reports forbidden when nothing matched and the version is unchanged (row-level security refused it)', async () => {
    const h = harness({ records: [{ data: [], error: null }, { data: { id: 'r1', version: 3 }, error: null }] });
    expect(await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).updateRecord('t', 'r1', 3, patch)).toEqual({ ok: false, reason: 'forbidden' });
  });

  it.each([['42501', 'forbidden'], ['23514', 'invalid']])('maps database error %s to %s', async (code, reason) => {
    const h = harness({ records: [{ data: null, error: { code, message: 'x' } }] });
    expect(await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).updateRecord('t', 'r1', 3, patch)).toEqual({ ok: false, reason });
  });

  it('throws on unexpected database errors', async () => {
    const h = harness({ records: [{ data: null, error: { code: '57014', message: 'timeout' } }] });
    await expect(createAgentStore(ENV, { createClientImpl: h.createClientImpl }).updateRecord('t', 'r1', 3, patch)).rejects.toThrow('timeout');
  });
});

describe('uploadAttachments', () => {
  const FARM = '11111111-1111-4111-8111-111111111111';
  const file = (media_type, data) => ({ type: media_type === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type, data } });

  function storageHarness(uploadResult = { error: null }) {
    const h = harness();
    const uploads = [];
    const buckets = [];
    h.createClientImpl.mockImplementation((url, key, options) => {
      const client = { url, key, options, storage: { from: (bucket) => { buckets.push(bucket); return { upload: async (path, body, opts) => { uploads.push({ path, body, opts }); return uploadResult; } }; } } };
      h.clients.push(client);
      return client;
    });
    return { h, uploads, buckets };
  }

  it('writes each file to the private bucket with the service-role client and returns a manifest', async () => {
    const { h, uploads, buckets } = storageHarness();
    const store = createAgentStore(ENV, { createClientImpl: h.createClientImpl });
    const out = await store.uploadAttachments({ farmId: FARM, captureHash: HASH, attachments: [file('image/jpeg', 'AAAA'), file('application/pdf', 'QUJD')] });

    expect(buckets).toEqual(['record-files']);
    expect(h.clients[0].key).toBe('service-key');
    expect(uploads.map((u) => u.path)).toEqual([`${FARM}/${HASH}/0.jpg`, `${FARM}/${HASH}/1.pdf`]);
    expect(uploads[0].body.equals(Buffer.from('AAAA', 'base64'))).toBe(true);
    expect(uploads[0].opts).toEqual({ contentType: 'image/jpeg', upsert: true });
    expect(out).toEqual([
      { path: `${FARM}/${HASH}/0.jpg`, media_type: 'image/jpeg', bytes: 3 },
      { path: `${FARM}/${HASH}/1.pdf`, media_type: 'application/pdf', bytes: 3 },
    ]);
  });

  it.each([['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']])('names %s files .%s', async (type, ext) => {
    const { h, uploads } = storageHarness();
    await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).uploadAttachments({ farmId: FARM, captureHash: HASH, attachments: [file(type, 'AAAA')] });
    expect(uploads[0].path.endsWith(`/0.${ext}`)).toBe(true);
  });

  it('throws when the upload fails, so the caller can warn', async () => {
    const { h } = storageHarness({ error: { message: 'bucket gone' } });
    await expect(createAgentStore(ENV, { createClientImpl: h.createClientImpl }).uploadAttachments({ farmId: FARM, captureHash: HASH, attachments: [file('image/jpeg', 'AAAA')] })).rejects.toThrow('bucket gone');
  });

  it.each([
    ['a farm id that is not a uuid', { farmId: '../etc', captureHash: HASH }],
    ['a capture key that is not a hash', { farmId: FARM, captureHash: '../../x' }],
  ])('refuses %s (no path traversal)', async (_n, ids) => {
    const { h, uploads } = storageHarness();
    await expect(createAgentStore(ENV, { createClientImpl: h.createClientImpl }).uploadAttachments({ ...ids, attachments: [file('image/jpeg', 'AAAA')] })).rejects.toThrow(/invalid/i);
    expect(uploads).toHaveLength(0);
  });

  it('refuses a media type it has no extension for', async () => {
    const { h, uploads } = storageHarness();
    await expect(createAgentStore(ENV, { createClientImpl: h.createClientImpl }).uploadAttachments({ farmId: FARM, captureHash: HASH, attachments: [file('image/svg+xml', 'AAAA')] })).rejects.toThrow(/media type/i);
    expect(uploads).toHaveLength(0);
  });
});

describe('searchRegulations', () => {
  function rpcHarness(result) {
    const h = harness();
    const calls = [];
    h.createClientImpl.mockImplementation((url, key, options) => {
      const client = { url, key, options, rpc: async (fn, args) => { calls.push({ fn, args }); return result; } };
      h.clients.push(client);
      return client;
    });
    return { h, calls };
  }

  it('calls the search function as the caller (their token, the anon key), never the service role', async () => {
    const { h, calls } = rpcHarness({ data: [{ citation: '7 CFR 205.601(i)' }], error: null });
    const rows = await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).searchRegulations('tok', 'copper sulfate', 4);
    expect(rows).toEqual([{ citation: '7 CFR 205.601(i)' }]);
    expect(calls).toEqual([{ fn: 'search_regulations', args: { search_query: 'copper sulfate', max_results: 4 } }]);
    expect(h.clients[0].key).toBe('anon-key');
    expect(h.clients[0].options.global.headers.Authorization).toBe('Bearer tok');
  });

  it('returns an empty list for no hits and throws on a database error', async () => {
    const none = rpcHarness({ data: null, error: null });
    expect(await createAgentStore(ENV, { createClientImpl: none.h.createClientImpl }).searchRegulations('t', 'q')).toEqual([]);
    const bad = rpcHarness({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(createAgentStore(ENV, { createClientImpl: bad.h.createClientImpl }).searchRegulations('t', 'q')).rejects.toThrow('permission denied');
  });
});

describe('takeRateToken', () => {
  function rpcService(result) {
    const h = harness();
    const calls = [];
    h.createClientImpl.mockImplementation((url, key, options) => {
      const client = { url, key, options, rpc: async (fn, args) => { calls.push({ fn, args }); return result; } };
      h.clients.push(client);
      return client;
    });
    return { h, calls };
  }

  it('asks the database with the service role, passing the verified subject and the limit', async () => {
    const { h, calls } = rpcService({ data: [{ allowed: false, retry_after_sec: 17 }], error: null });
    const out = await createAgentStore(ENV, { createClientImpl: h.createClientImpl }).takeRateToken('agent-min', 'user-1', 6, 60);
    expect(out).toEqual({ allowed: false, retry_after_sec: 17 });
    expect(calls).toEqual([{ fn: 'take_rate_token', args: { p_bucket: 'agent-min', p_subject: 'user-1', p_max: 6, p_window_seconds: 60 } }]);
    expect(h.clients[0].key).toBe('service-key');
    expect(h.clients[0].options.global).toBeUndefined();
  });

  it('throws on a database error, and when the answer is not a verdict', async () => {
    const bad = rpcService({ data: null, error: { code: '57014', message: 'timeout' } });
    await expect(createAgentStore(ENV, { createClientImpl: bad.h.createClientImpl }).takeRateToken('b', 's', 1, 1)).rejects.toThrow('timeout');
    const empty = rpcService({ data: [], error: null });
    await expect(createAgentStore(ENV, { createClientImpl: empty.h.createClientImpl }).takeRateToken('b', 's', 1, 1)).rejects.toThrow(/verdict/i);
  });

  it('refuses without the service-role key', async () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _drop, ...env } = ENV;
    const { h } = rpcService({ data: [], error: null });
    await expect(createAgentStore(env, { createClientImpl: h.createClientImpl }).takeRateToken('b', 's', 1, 1)).rejects.toThrow(/SERVICE_ROLE/);
  });
});
