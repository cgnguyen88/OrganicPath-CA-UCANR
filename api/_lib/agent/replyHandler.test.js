import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createReplyHandler } from './replyHandler.js';
import { createRateLimiter } from '../rateLimiter.js';
import { makeReq, makeRes } from '../testHttp.js';

const USER = { id: 'user-1' };
const RECORD_ID = '33333333-3333-4333-8333-333333333333';
const FARM_ID = '11111111-1111-4111-8111-111111111111';
const TODAY = '2026-10-12';

const config = {
  allowedOrigins: [],
  limits: {},
  agent: { model: 'm', maxTokens: 100, effort: 'medium', strictTools: true, requestTimeoutMs: 1000, timeZone: 'America/Los_Angeles', limits: { maxTextChars: 50, maxAttachments: 2 }, rate: { perMinute: 5, perDay: 50 } },
};

const row = (extra = {}) => ({
  id: RECORD_ID, farm_id: FARM_ID, kind: 'seed', status: 'needs_info', record_date: null,
  payload: { crop: 'Tomato' }, missing_fields: ['record_date', 'supplier'], confidence: 0.6, version: 3, created_by: USER.id, ...extra,
});

const merged = (over = {}) => ({
  record: { kind: 'seed', record_date: '2026-10-10', payload: { crop: 'Tomato', supplier: 'Johnnys' } },
  evaluation: { ok: true, complete: true, missing: [], value: { record_date: '2026-10-10', payload: { crop: 'Tomato', supplier: 'Johnnys' } } },
  applied: ['record_date', 'supplier'], rejected: [], message: '', usage: { input_tokens: 5, output_tokens: 2 }, ...over,
});

let store; let reply; let logger;

function build(overrides = {}) {
  return createReplyHandler({
    config,
    verifyToken: async (t) => (t === 'good-token' ? USER : null),
    getAnthropic: () => ({ fake: true }),
    store, reply, today: () => TODAY,
    minuteLimiter: createRateLimiter({ max: 100, windowMs: 60_000 }),
    dayLimiter: createRateLimiter({ max: 100, windowMs: 86_400_000 }),
    logger, ...overrides,
  });
}
const call = async (handler, body, opts = {}) => { const res = makeRes(); await handler(makeReq({ body, ...opts }), res); return res; };

beforeEach(() => {
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  store = {
    resolveMembership: vi.fn(async () => ({ farmId: FARM_ID, role: 'crew' })),
    loadRecord: vi.fn(async () => row()),
    updateRecord: vi.fn(async (_t, _id, _v, patch) => ({ ok: true, row: row({ ...patch, version: 4 }) })),
  };
  reply = vi.fn(async () => merged());
});

describe('reply handler — front door and validation', () => {
  it('requires a session', async () => {
    const res = await call(build(), { record_id: RECORD_ID, text: 'x' }, { headers: { authorization: '' } });
    expect(res.statusCode).toBe(401);
    expect(store.loadRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['missing id', { text: 'x' }],
    ['not a uuid', { record_id: "1' or 1=1", text: 'x' }],
    ['no text', { record_id: RECORD_ID }],
    ['blank text', { record_id: RECORD_ID, text: '   ' }],
    ['bad language', { record_id: RECORD_ID, text: 'x', lang: 'fr' }],
  ])('400 for %s', async (_n, body) => {
    const res = await call(build(), body);
    expect(res.statusCode).toBe(400);
    expect(store.loadRecord).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('413 for an over-long reply', async () => {
    const res = await call(build(), { record_id: RECORD_ID, text: 'x'.repeat(51) });
    expect(res.statusCode).toBe(413);
  });
});

describe('reply handler — which record', () => {
  it('404s a record the caller cannot see (row-level security returns nothing)', async () => {
    store.loadRecord.mockResolvedValue(null);
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(res.statusCode).toBe(404);
    expect(reply).not.toHaveBeenCalled();
  });

  it('loads the record with the caller’s own token', async () => {
    await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(store.loadRecord).toHaveBeenCalledWith('good-token', RECORD_ID);
  });

  it.each(['approved', 'rejected', 'voided', 'pending_review'])('409s a record that is %s: replies only fill in records still waiting for details', async (status) => {
    store.loadRecord.mockResolvedValue(row({ status }));
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(res.statusCode).toBe(409);
    expect(reply).not.toHaveBeenCalled();
    expect(store.updateRecord).not.toHaveBeenCalled();
  });

  it('503s when the model is not configured', async () => {
    const res = await call(build({ getAnthropic: () => null }), { record_id: RECORD_ID, text: 'x' });
    expect(res.statusCode).toBe(503);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('reply handler — who may answer, and what an answer may change', () => {
  it('refuses a teammate’s record before spending a model call', async () => {
    store.loadRecord.mockResolvedValue(row({ created_by: 'someone-else' }));
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(res.statusCode).toBe(403);
    expect(reply).not.toHaveBeenCalled();
    expect(store.updateRecord).not.toHaveBeenCalled();
  });

  it.each(['owner', 'manager'])('lets a farm %s answer for a teammate', async (role) => {
    store.loadRecord.mockResolvedValue(row({ created_by: 'someone-else' }));
    store.resolveMembership.mockResolvedValue({ farmId: FARM_ID, role });
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(res.statusCode).toBe(200);
    expect(reply).toHaveBeenCalled();
  });

  it('does not accept a manager role from a different farm', async () => {
    store.loadRecord.mockResolvedValue(row({ created_by: 'someone-else' }));
    store.resolveMembership.mockResolvedValue({ farmId: '99999999-9999-4999-8999-999999999999', role: 'owner' });
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(res.statusCode).toBe(403);
    expect(reply).not.toHaveBeenCalled();
  });

  it('needs no membership lookup for the author’s own record', async () => {
    await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(store.resolveMembership).not.toHaveBeenCalled();
  });

  it('503s without leaking the cause when the membership lookup fails', async () => {
    store.loadRecord.mockResolvedValue(row({ created_by: 'someone-else' }));
    store.resolveMembership.mockRejectedValue(new Error('db secret detail'));
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('secret detail');
  });

  it('lets the model fill only the details that were missing', async () => {
    await call(build(), { record_id: RECORD_ID, text: 'Johnnys' });
    expect(reply.mock.calls[0][0].allowedKeys).toEqual(['record_date', 'supplier']);
  });
});

describe('reply handler — merging and saving', () => {
  it('merges against the stored record, not anything the client sent', async () => {
    await call(build(), { record_id: RECORD_ID, text: 'Johnnys, Oct 10', draft: { kind: 'purchase', payload: { evil: 1 } }, kind: 'purchase' });
    const arg = reply.mock.calls[0][0];
    expect(arg.draft).toEqual({ kind: 'seed', record_date: null, payload: { crop: 'Tomato' } });
    expect(arg.replyText).toBe('Johnnys, Oct 10');
    expect(arg.today).toBe(TODAY);
  });

  it('moves a now-complete record to review, guarded by the version it read', async () => {
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys, Oct 10' });
    const [token, id, version, patch] = store.updateRecord.mock.calls[0];
    expect([token, id, version]).toEqual(['good-token', RECORD_ID, 3]);
    expect(patch).toMatchObject({ status: 'pending_review', missing_fields: [], record_date: '2026-10-10', payload: { crop: 'Tomato', supplier: 'Johnnys' } });
    expect(patch.fingerprint).toMatch(/^seed\|2026-10-10\|/);
    expect(res.statusCode).toBe(200);
    expect(res.json.record).toMatchObject({ id: RECORD_ID, status: 'pending_review', version: 4 });
    expect(res.json.record.questions.text).toBe('');
  });

  it('only ever writes the columns people may edit, and never approves', async () => {
    await call(build(), { record_id: RECORD_ID, text: 'Johnnys', status: 'approved', farm_id: 'x', created_by: 'x', source: 'manual' });
    const patch = store.updateRecord.mock.calls[0][3];
    expect(Object.keys(patch).sort()).toEqual(['fingerprint', 'missing_fields', 'payload', 'record_date', 'status']);
    expect(patch.status).not.toBe('approved');
  });

  it('keeps asking when details are still missing', async () => {
    reply.mockResolvedValue(merged({
      record: { kind: 'seed', record_date: null, payload: { crop: 'Tomato', supplier: 'Johnnys' } },
      evaluation: { ok: true, complete: false, missing: ['record_date'], value: { record_date: null, payload: { crop: 'Tomato', supplier: 'Johnnys' } } },
      applied: ['supplier'],
    }));
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys', lang: 'es' });
    expect(store.updateRecord.mock.calls[0][3]).toMatchObject({ status: 'needs_info', missing_fields: ['record_date'] });
    expect(res.json.record.questions.text).toMatch(/fecha/i);
    expect(res.json.applied).toEqual(['supplier']);
  });

  it('saves nothing when the reply changed nothing, and passes the model’s question on', async () => {
    reply.mockResolvedValue(merged({
      record: { kind: 'seed', record_date: null, payload: { crop: 'Tomato' } },
      evaluation: { ok: true, complete: false, missing: ['record_date', 'supplier'], value: { record_date: null, payload: { crop: 'Tomato' } } },
      applied: [], message: 'Which supplier was it?',
    }));
    const res = await call(build(), { record_id: RECORD_ID, text: 'um' });
    expect(store.updateRecord).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.json.message).toBe('Which supplier was it?');
    expect(res.json.record.id).toBe(RECORD_ID);
  });

  it('reports values it ignored because they did not validate', async () => {
    reply.mockResolvedValue(merged({ rejected: ['record_date'] }));
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys, last tuesday-ish' });
    expect(res.json.rejected).toEqual(['record_date']);
  });

  it.each([
    [{ ok: false, reason: 'conflict' }, 409],
    [{ ok: false, reason: 'forbidden' }, 403],
    [{ ok: false, reason: 'invalid' }, 422],
  ])('maps a refused update %j to %i', async (outcome, status) => {
    store.updateRecord.mockResolvedValue(outcome);
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys, Oct 10' });
    expect(res.statusCode).toBe(status);
  });

  it('hides database details when the update blows up', async () => {
    store.updateRecord.mockRejectedValue(new Error('relation "records" secret detail'));
    const res = await call(build(), { record_id: RECORD_ID, text: 'Johnnys, Oct 10' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('reply handler — upstream failures', () => {
  it('maps model errors to safe messages and saves nothing', async () => {
    reply.mockRejectedValue(Anthropic.APIError.generate(529, { type: 'error', error: { type: 'x', message: 'overloaded sk-ant-SECRET' } }, 'overloaded sk-ant-SECRET', new Headers()));
    const res = await call(build(), { record_id: RECORD_ID, text: 'x' });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('SECRET');
    expect(store.updateRecord).not.toHaveBeenCalled();
  });
});

describe('reply handler — the farm’s fields', () => {
  it('tells the model the record’s farm’s field names, read as the caller', async () => {
    store.listFieldNames = vi.fn(async () => ['B2', 'North 40']);
    const res = await call(build(), { record_id: RECORD_ID, text: 'en el b2' });
    expect(res.statusCode).toBe(200);
    expect(store.listFieldNames).toHaveBeenCalledWith('good-token', { farmId: FARM_ID });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ fieldNames: ['B2', 'North 40'] }));
  });

  it('goes on without names when the list cannot be read, or the store has none', async () => {
    store.listFieldNames = vi.fn(async () => { throw new Error('db down'); });
    expect((await call(build(), { record_id: RECORD_ID, text: 'x' })).statusCode).toBe(200);
    expect(reply.mock.calls[0][0].fieldNames).toEqual([]);
    delete store.listFieldNames;
    expect((await call(build(), { record_id: RECORD_ID, text: 'x' })).statusCode).toBe(200);
    expect(reply.mock.calls[1][0].fieldNames).toEqual([]);
  });
});
