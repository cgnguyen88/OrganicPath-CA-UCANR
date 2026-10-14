import { describe, it, expect, vi } from 'vitest';
import { createChannelStore } from './channelStore.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const HASH = 'a'.repeat(64);
const FARM = '11111111-1111-4111-8111-111111111111';

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

function build(results = {}, rpcResults = {}) {
  const queries = [];
  const rpcCalls = [];
  const clients = [];
  const createClientImpl = vi.fn((url, key, options) => {
    const client = {
      key, options,
      from: (table) => {
        const queue = results[table] ?? [];
        const { query, calls } = fakeQuery(queue.length > 1 ? queue.shift() : queue[0] ?? { data: null, error: null });
        queries.push({ table, calls });
        return query;
      },
      rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return rpcResults[fn] ?? { data: null, error: null }; },
    };
    clients.push(client);
    return client;
  });
  const agentStore = { insertRecords: vi.fn(async (rows) => rows), uploadAttachments: vi.fn(async () => []) };
  return { store: createChannelStore(ENV, { createClientImpl, agentStore }), queries, rpcCalls, clients, agentStore };
}
const has = (calls, name, ...args) => calls.some(([n, ...a]) => n === name && args.every((v, i) => JSON.stringify(a[i]) === JSON.stringify(v)));

describe('configuration', () => {
  it('uses only the server role, never a session', async () => {
    const { store, clients } = build({}, { claim_channel_update: { data: true, error: null } });
    await store.claimUpdate('telegram', 1);
    expect(clients[0].key).toBe('service-key');
    expect(clients[0].options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    expect(clients[0].options.global).toBeUndefined();
  });

  it('refuses to work without the service-role key', async () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _drop, ...env } = ENV;
    const store = createChannelStore(env, { createClientImpl: vi.fn(), agentStore: {} });
    await expect(store.claimUpdate('telegram', 1)).rejects.toThrow(/SERVICE_ROLE/);
  });
});

describe('linking', () => {
  it('redeems a code by its hash and returns who it was for', async () => {
    const { store, rpcCalls } = build({}, { consume_channel_link_code: { data: [{ r_user_id: 'u1', r_farm_id: FARM, r_lang: 'es', r_farm_name: 'Sunny Acres', r_owner_hint: 'a***@x.com' }], error: null } });
    expect(await store.consumeLinkCode('telegram', HASH, '555', 'Maria (@maria)')).toEqual({ userId: 'u1', farmId: FARM, lang: 'es', farmName: 'Sunny Acres', ownerHint: 'a***@x.com' });
    expect(rpcCalls).toEqual([{ fn: 'consume_channel_link_code', args: { p_provider: 'telegram', p_code_hash: HASH, p_external_id: '555', p_display_name: 'Maria (@maria)' } }]);
  });

  it('returns null for a code that did not work, and throws on a database error', async () => {
    expect(await build({}, { consume_channel_link_code: { data: [], error: null } }).store.consumeLinkCode('telegram', HASH, '5')).toBeNull();
    await expect(build({}, { consume_channel_link_code: { data: null, error: { message: 'boom' } } }).store.consumeLinkCode('telegram', HASH, '5')).rejects.toThrow('boom');
  });

  it('asks for confirmation only from a link that is recent, and confirms by chat account', async () => {
    const { store, queries, rpcCalls } = build({ channel_identities: [{ data: { id: 'i9', lang: 'es' }, error: null }] }, { confirm_channel_identity: { data: true, error: null } });
    expect(await store.resolvePending('telegram', '555', '2026-10-13T11:45:00.000Z')).toEqual({ identityId: 'i9', lang: 'es' });
    const c = queries[0].calls;
    expect(has(c, 'eq', 'external_id', '555') && has(c, 'is', 'confirmed_at', null) && has(c, 'gte', 'linked_at', '2026-10-13T11:45:00.000Z')).toBe(true);
    expect(await store.confirmIdentity('telegram', '555')).toBe(true);
    expect(rpcCalls).toEqual([{ fn: 'confirm_channel_identity', args: { p_provider: 'telegram', p_external_id: '555' } }]);
  });

  it('does not treat a pending link as a connected one', async () => {
    const { store, queries } = build({ channel_identities: [{ data: null, error: null }] });
    expect(await store.resolveIdentity('telegram', '555')).toBeNull();
    expect(has(queries[0].calls, 'not', 'confirmed_at', 'is', null)).toBe(true);
  });

  it('finds the person behind a chat account, and only while they still belong to the farm', async () => {
    const { store, queries } = build({
      channel_identities: [{ data: { id: 'i1', user_id: 'u1', farm_id: FARM, lang: 'es' }, error: null }],
      farm_members: [{ data: { role: 'crew' }, error: null }],
    });
    expect(await store.resolveIdentity('telegram', '555')).toEqual({ identityId: 'i1', userId: 'u1', farmId: FARM, lang: 'es', role: 'crew' });
    expect(has(queries[0].calls, 'eq', 'provider', 'telegram')).toBe(true);
    expect(has(queries[0].calls, 'eq', 'external_id', '555')).toBe(true);
    expect(has(queries[1].calls, 'eq', 'user_id', 'u1') && has(queries[1].calls, 'eq', 'farm_id', FARM)).toBe(true);
  });

  it('treats an unknown chat account, or one whose owner left the farm, as unlinked', async () => {
    expect(await build({ channel_identities: [{ data: null, error: null }] }).store.resolveIdentity('telegram', '1')).toBeNull();
    const left = build({ channel_identities: [{ data: { id: 'i1', user_id: 'u1', farm_id: FARM, lang: 'en' }, error: null }], farm_members: [{ data: null, error: null }] });
    expect(await left.store.resolveIdentity('telegram', '1')).toBeNull();
  });

  it('changes the language and unlinks, by identity id', async () => {
    const { store, queries } = build({ channel_identities: [{ data: null, error: null }] });
    await store.setLang('i1', 'es');
    await store.unlink('i1');
    expect(has(queries[0].calls, 'update', { lang: 'es' }) && has(queries[0].calls, 'eq', 'id', 'i1')).toBe(true);
    expect(has(queries[1].calls, 'delete') && has(queries[1].calls, 'eq', 'id', 'i1')).toBe(true);
  });
});

describe('retries', () => {
  it('says whether an update is new', async () => {
    expect(await build({}, { claim_channel_update: { data: true, error: null } }).store.claimUpdate('telegram', 9)).toBe(true);
    expect(await build({}, { claim_channel_update: { data: false, error: null } }).store.claimUpdate('telegram', 9)).toBe(false);
  });

  it('fails closed on a database error rather than processing twice', async () => {
    await expect(build({}, { claim_channel_update: { data: null, error: { message: 'down' } } }).store.claimUpdate('telegram', 9)).rejects.toThrow('down');
    await expect(build({}, { claim_channel_update: { data: 'yes', error: null } }).store.claimUpdate('telegram', 9)).rejects.toThrow(/verdict/i);
  });
});

describe('finding the record a reply is about', () => {
  it('remembers which bot message asked about which record', async () => {
    const { store, queries } = build({ channel_messages: [{ data: null, error: null }] });
    await store.rememberMessage('telegram', '555', 88, 'r1');
    expect(has(queries[0].calls, 'insert', { provider: 'telegram', chat_id: '555', message_id: 88, record_id: 'r1' })).toBe(true);
  });

  it('looks a replied-to message up, then loads the record only if it is the caller’s own, in their farm', async () => {
    const { store, queries } = build({
      channel_messages: [{ data: { record_id: 'r1' }, error: null }],
      records: [{ data: { id: 'r1', status: 'needs_info' }, error: null }],
    });
    expect(await store.recordForMessage({ provider: 'telegram', chatId: '555', messageId: 88, userId: 'u1', farmId: FARM })).toEqual({ id: 'r1', status: 'needs_info' });
    expect(has(queries[0].calls, 'eq', 'message_id', 88) && has(queries[0].calls, 'eq', 'chat_id', '555')).toBe(true);
    const r = queries[1].calls;
    expect(has(r, 'eq', 'id', 'r1') && has(r, 'eq', 'farm_id', FARM) && has(r, 'eq', 'created_by', 'u1')).toBe(true);
  });

  it('returns null when the message is unknown', async () => {
    expect(await build({ channel_messages: [{ data: null, error: null }] }).store.recordForMessage({ provider: 'telegram', chatId: '1', messageId: 1, userId: 'u', farmId: FARM })).toBeNull();
  });

  it('finds the latest record still waiting for details: the caller’s own, in their farm, from Telegram, recent', async () => {
    const { store, queries } = build({ records: [{ data: [{ id: 'r2' }], error: null }] });
    expect(await store.latestOpenRecord({ userId: 'u1', farmId: FARM, since: '2026-10-12T00:00:00.000Z' })).toEqual({ id: 'r2' });
    const c = queries[0].calls;
    for (const [col, val] of [['farm_id', FARM], ['created_by', 'u1'], ['source', 'telegram'], ['status', 'needs_info']]) expect(has(c, 'eq', col, val), col).toBe(true);
    expect(has(c, 'gte', 'created_at', '2026-10-12T00:00:00.000Z')).toBe(true);
    expect(has(c, 'order', 'created_at', { ascending: false })).toBe(true);
    expect(has(c, 'limit', 1)).toBe(true);
  });
});

describe('capture ports', () => {
  it('looks for earlier captures within the caller’s farm and the capture key only', async () => {
    const { store, queries } = build({ records: [{ data: [{ id: 'r1' }], error: null }] });
    expect(await store.findCapture({ farmId: FARM, captureHash: HASH })).toEqual([{ id: 'r1' }]);
    expect(has(queries[0].calls, 'eq', 'farm_id', FARM)).toBe(true);
    expect(has(queries[0].calls, 'like', 'source_ref', `${HASH}#%`)).toBe(true);
  });

  it.each([['%'], ['abc'], [`${'a'.repeat(63)}%`]])('refuses a malformed capture key %j', async (bad) => {
    const { store, queries } = build();
    await expect(store.findCapture({ farmId: FARM, captureHash: bad })).rejects.toThrow(/capture key/i);
    expect(queries).toHaveLength(0);
  });

  it('lists the active field names of the linked farm only, by name', async () => {
    const { store, queries } = build({ fields: [{ data: [{ name: 'B2' }, { name: 'North 40' }], error: null }] });
    expect(await store.listFieldNames({ farmId: FARM })).toEqual(['B2', 'North 40']);
    expect(queries[0].table).toBe('fields');
    expect(has(queries[0].calls, 'eq', 'farm_id', FARM)).toBe(true);
    expect(has(queries[0].calls, 'eq', 'is_active', true)).toBe(true);
    expect(has(queries[0].calls, 'order', 'name')).toBe(true);
    expect(has(queries[0].calls, 'limit', 101)).toBe(true);
  });

  it('gives no names for a farm with none, and fails when the database does', async () => {
    expect(await build({ fields: [{ data: null, error: null }] }).store.listFieldNames({ farmId: FARM })).toEqual([]);
    await expect(build({ fields: [{ data: null, error: { code: '42P01', message: 'no such table' } }] }).store.listFieldNames({ farmId: FARM })).rejects.toMatchObject({ code: '42P01' });
  });

  it('hands saving and file storage to the agent store', async () => {
    const { store, agentStore } = build();
    await store.insertRecords([{ kind: 'note' }]);
    await store.uploadAttachments({ farmId: FARM, captureHash: HASH, attachments: [] });
    expect(agentStore.insertRecords).toHaveBeenCalledWith([{ kind: 'note' }]);
    expect(agentStore.uploadAttachments).toHaveBeenCalledWith({ farmId: FARM, captureHash: HASH, attachments: [] });
  });
});

describe('updateRecord', () => {
  const patch = { payload: { a: 1 }, status: 'pending_review' };

  it('applies a reply through the guarded function, naming the person it is for', async () => {
    const { store, rpcCalls } = build({}, { channel_update_record: { data: [{ id: 'r1', version: 4 }], error: null } });
    expect(await store.updateRecord('u1', FARM, 'r1', 3, patch)).toEqual({ ok: true, row: { id: 'r1', version: 4 } });
    expect(rpcCalls).toEqual([{ fn: 'channel_update_record', args: { p_actor: 'u1', p_farm_id: FARM, p_record_id: 'r1', p_expected_version: 3, p_patch: patch } }]);
  });

  it('reports a conflict when nothing matched (changed meanwhile, in review, or not theirs)', async () => {
    expect(await build({}, { channel_update_record: { data: [], error: null } }).store.updateRecord('u1', FARM, 'r1', 3, patch)).toEqual({ ok: false, reason: 'conflict' });
  });

  it('maps a record-guard refusal to invalid, and throws on anything else', async () => {
    expect(await build({}, { channel_update_record: { data: null, error: { code: '23514', message: 'Record is incomplete' } } }).store.updateRecord('u1', FARM, 'r1', 3, patch)).toEqual({ ok: false, reason: 'invalid' });
    await expect(build({}, { channel_update_record: { data: null, error: { code: '57014', message: 'timeout' } } }).store.updateRecord('u1', FARM, 'r1', 3, patch)).rejects.toThrow('timeout');
  });
});
