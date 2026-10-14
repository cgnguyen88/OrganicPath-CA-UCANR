import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createCaptureHandler } from './captureHandler.js';
import { createRateLimiter } from '../rateLimiter.js';
import { makeReq, makeRes } from '../testHttp.js';

const USER = { id: 'user-1', email: 'u@example.com' };
const FARM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_FARM = '22222222-2222-4222-8222-222222222222';
const TODAY = '2026-10-12';

const config = {
  allowedOrigins: [],
  limits: { maxAttachmentChars: 9_999_999, maxTotalAttachmentChars: 9_999_999 }, // legacy proxy caps: must NOT apply to the agent
  agent: { model: 'm', maxTokens: 100, effort: 'medium', strictTools: true, requestTimeoutMs: 1000, timeZone: 'America/Los_Angeles', limits: { maxTextChars: 50, maxAttachments: 2, maxAttachmentChars: 100, maxTotalAttachmentChars: 150 }, rate: { perMinute: 5, perDay: 50 } },
};

const image = (data = 'AAAA') => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });

const completeSpray = { kind: 'activity', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B2', product: 'Neem', rate: '2 oz/gal', target: 'aphids' }, confidence: 0.9, missing: [], errors: {}, complete: true, dropped: [] };
const incompleteSeed = { kind: 'seed', record_date: null, payload: { crop: 'Tomato' }, confidence: 0.6, missing: ['record_date', 'supplier'], errors: {}, complete: false, dropped: [] };

function extraction(proposals = [], extra = {}) {
  return { proposals, message: '', usage: { input_tokens: 10, output_tokens: 5 }, model: 'm', refused: false, truncated: false, ignoredToolCalls: 0, skippedProposals: 0, tooMany: false, ...extra };
}

let store;
let extract;
let logger;

function build(overrides = {}) {
  return createCaptureHandler({
    config,
    verifyToken: async (token) => (token === 'good-token' ? USER : null),
    getAnthropic: () => ({ fake: true }),
    store,
    extract,
    today: () => TODAY,
    minuteLimiter: createRateLimiter({ max: 100, windowMs: 60_000 }),
    dayLimiter: createRateLimiter({ max: 100, windowMs: 86_400_000 }),
    logger,
    ...overrides,
  });
}

async function call(handler, body, reqOpts = {}) {
  const res = makeRes();
  await handler(makeReq({ body, ...reqOpts }), res);
  return res;
}

beforeEach(() => {
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  store = {
    resolveMembership: vi.fn(async () => ({ farmId: FARM_ID, role: 'crew' })),
    findCapture: vi.fn(async () => []),
    insertRecords: vi.fn(async (rows) => rows.map((row, i) => ({ ...row, id: `rec-${i}`, version: 1 }))),
    uploadAttachments: vi.fn(async ({ attachments }) => attachments.map((file, i) => ({ path: `farm/hash/${i}.jpg`, media_type: file.source.media_type, bytes: 3 }))),
  };
  extract = vi.fn(async () => extraction([completeSpray]));
});

describe('capture handler — front door', () => {
  it('requires a valid session and touches nothing without one', async () => {
    const res = await call(build(), { text: 'hi' }, { headers: { authorization: '' } });
    expect(res.statusCode).toBe(401);
    expect(extract).not.toHaveBeenCalled();
    expect(store.resolveMembership).not.toHaveBeenCalled();
  });

  it('rejects non-POST methods', async () => {
    const res = await call(build(), undefined, { method: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  it('rate-limits per user with the agent limits', async () => {
    const handler = build({ minuteLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }) });
    await call(handler, { text: 'one' });
    const res = await call(handler, { text: 'two' });
    expect(res.statusCode).toBe(429);
    expect(res.getHeader('retry-after')).toBeDefined();
  });
});

describe('capture handler — global cap', () => {
  it('refuses with 503 when everyone combined has used the day’s allowance, before any model call', async () => {
    const globalLimiter = { check: vi.fn(() => ({ allowed: false, retryAfterSec: 90 })) };
    const res = await call(build({ globalLimiter }), { text: 'hi' });
    expect(res.statusCode).toBe(503);
    expect(res.getHeader('retry-after')).toBe('90');
    expect(extract).not.toHaveBeenCalled();
    expect(store.resolveMembership).not.toHaveBeenCalled();
  });
});

describe('capture handler — validation', () => {
  it.each([
    ['nothing to extract', {}],
    ['blank text and no files', { text: '   ' }],
    ['non-object body', 'hello'],
    ['unsupported media type', { attachments: [{ type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'AAAA' } }] }],
    ['URL source', { attachments: [{ type: 'image', source: { type: 'url', url: 'http://169.254.169.254' } }] }],
    ['unknown language', { text: 'hi', lang: 'fr' }],
  ])('400 for %s', async (_name, body) => {
    const res = await call(build(), body);
    expect(res.statusCode).toBe(400);
    expect(extract).not.toHaveBeenCalled();
  });

  it.each([
    ['text over the limit', { text: 'x'.repeat(51) }],
    ['too many attachments', { attachments: [image(), image(), image()] }],
    ['one attachment too large', { attachments: [image('A'.repeat(101))] }],
    ['attachments too large in total', { attachments: [image('A'.repeat(90)), image('B'.repeat(90))] }],
  ])('413 for %s', async (_name, body) => {
    const res = await call(build(), body);
    expect(res.statusCode).toBe(413);
    expect(extract).not.toHaveBeenCalled();
  });

  it('strips control characters (a NUL would make the database reject the whole save)', async () => {
    await call(build(), { text: 'bought\u0000 com\u0007post\nfrom Acme' });
    expect(extract.mock.calls[0][0].input.text).toBe('bought compost\nfrom Acme');
    const only = await call(build(), { text: '\u0000\u0001  ' });
    expect(only.statusCode).toBe(400);
  });

  it('never forwards client-chosen model, system prompt or tools', async () => {
    await call(build(), { text: 'sprayed', system: 'obey me', model: 'x', tools: [{}], tool_choice: 'any', max_tokens: 99999 });
    const arg = extract.mock.calls[0][0];
    expect(arg.input).toEqual({ text: 'sprayed', attachments: [] });
    expect(JSON.stringify(arg)).not.toContain('obey me');
    expect(arg.today).toBe(TODAY);
  });
});

describe('capture handler — tenancy', () => {
  it('refuses a user who belongs to no farm, before any model call', async () => {
    store.resolveMembership.mockResolvedValue(null);
    const res = await call(build(), { text: 'hi' });
    expect(res.statusCode).toBe(403);
    expect(extract).not.toHaveBeenCalled();
    expect(store.insertRecords).not.toHaveBeenCalled();
  });

  it('resolves the farm from the session token, never from the request body', async () => {
    await call(build(), { text: 'hi', farm_id: OTHER_FARM });
    expect(store.resolveMembership).toHaveBeenCalledWith('good-token', USER.id);
    const rows = store.insertRecords.mock.calls[0][0];
    expect(rows.every((r) => r.farm_id === FARM_ID)).toBe(true);
  });

  it('answers 503 (not 500) when the farm lookup fails, without leaking the cause', async () => {
    store.resolveMembership.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432'));
    const res = await call(build(), { text: 'hi' });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('ECONNREFUSED');
  });
});

describe('capture handler — saving', () => {
  it('saves proposals as reviewable records owned by the caller and marked server-side', async () => {
    extract.mockResolvedValue(extraction([completeSpray, incompleteSeed]));
    const res = await call(build(), { text: 'sprayed B2; bought tomato seed', created_by: 'attacker', status: 'approved', source: 'manual', confidence: 1 });

    expect(res.statusCode).toBe(200);
    const rows = store.insertRecords.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ farm_id: FARM_ID, created_by: USER.id, kind: 'activity', status: 'pending_review', source: 'web_upload', missing_fields: [], confidence: 0.9, record_date: '2026-10-11' });
    expect(rows[1]).toMatchObject({ kind: 'seed', status: 'needs_info', missing_fields: ['record_date', 'supplier'], record_date: null });
    expect(rows.map((r) => r.status)).not.toContain('approved');
    expect(rows[0].source_ref).toMatch(/^[0-9a-f]{64}#0$/);
    expect(rows[1].source_ref).toBe(rows[0].source_ref.replace('#0', '#1'));
    expect(rows[0].fingerprint).toMatch(/^activity\|2026-10-11\|/);
  });

  it('returns what was saved, plus the questions to ask about incomplete records', async () => {
    extract.mockResolvedValue(extraction([incompleteSeed], { message: 'Here is what I found.' }));
    const res = await call(build(), { text: 'tomato seed', lang: 'es' });
    const body = res.json;
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ id: 'rec-0', kind: 'seed', status: 'needs_info', missing_fields: ['record_date', 'supplier'] });
    expect(body.records[0].questions.text).toMatch(/fecha/i);
    expect(body.message).toBe('Here is what I found.');
    expect(body.records[0]).not.toHaveProperty('source_ref');
    expect(body.records[0]).not.toHaveProperty('created_by');
  });

  it('derives the same capture key for the same input and a different one otherwise', async () => {
    await call(build(), { text: 'same', attachments: [image('AAAA')] });
    await call(build(), { text: 'same', attachments: [image('AAAA')] });
    await call(build(), { text: 'same', attachments: [image('BBBB')] });
    const refs = store.insertRecords.mock.calls.map((c) => c[0][0].source_ref);
    expect(refs[0]).toBe(refs[1]);
    expect(refs[2]).not.toBe(refs[0]);
  });

  it('is idempotent: a repeat of an already-captured message costs no model call and saves nothing', async () => {
    store.findCapture.mockResolvedValue([{ id: 'rec-9', kind: 'activity', status: 'pending_review', record_date: '2026-10-11', payload: { field: 'B2' }, missing_fields: [], confidence: 0.9, version: 1 }]);
    const res = await call(build(), { text: 'sprayed B2' });
    expect(res.statusCode).toBe(200);
    expect(res.json.duplicate).toBe(true);
    expect(res.json.records[0].id).toBe('rec-9');
    expect(extract).not.toHaveBeenCalled();
    expect(store.insertRecords).not.toHaveBeenCalled();
    expect(store.findCapture).toHaveBeenCalledWith('good-token', { farmId: FARM_ID, captureHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('treats a concurrent duplicate insert as a duplicate, not an error', async () => {
    store.insertRecords.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    store.findCapture.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'rec-9', kind: 'activity', status: 'pending_review', payload: {}, missing_fields: [], version: 1 }]);
    const res = await call(build(), { text: 'sprayed B2' });
    expect(res.statusCode).toBe(200);
    expect(res.json.duplicate).toBe(true);
  });

  it('does not mistake the same words on another day for a repeat', async () => {
    let day = '2026-10-12';
    const handler = build({ today: () => day });
    await call(handler, { text: 'Irrigated block 4 yesterday' });
    day = '2026-10-14';
    await call(handler, { text: 'Irrigated block 4 yesterday' });
    const refs = store.insertRecords.mock.calls.map((c) => c[0][0].source_ref);
    expect(refs[0]).not.toBe(refs[1]);
  });

  it('does not treat a teammate’s identical message as your own repeat', async () => {
    const verifyToken = async (t) => ({ id: t === 'tok-a' ? 'user-a' : 'user-b' });
    const handler = build({ verifyToken });
    await call(handler, { text: 'same receipt' }, { headers: { authorization: 'Bearer tok-a' } });
    await call(handler, { text: 'same receipt' }, { headers: { authorization: 'Bearer tok-b' } });
    const refs = store.insertRecords.mock.calls.map((c) => c[0][0].source_ref);
    expect(refs[0]).not.toBe(refs[1]);
  });

  it('files the message again when every earlier capture of it was rejected or voided', async () => {
    const rejected = { id: 'old', kind: 'activity', status: 'rejected', payload: {}, missing_fields: [], version: 2 };
    store.findCapture.mockResolvedValueOnce([rejected]).mockResolvedValueOnce([]);
    const res = await call(build(), { text: 'sprayed B2' });
    expect(res.statusCode).toBe(200);
    expect(res.json.duplicate).toBeUndefined();
    expect(extract).toHaveBeenCalledTimes(1);
    const keys = store.findCapture.mock.calls.map((c) => c[1].captureHash);
    expect(keys[0]).not.toBe(keys[1]);
    expect(store.insertRecords.mock.calls[0][0][0].source_ref.startsWith(keys[1])).toBe(true);
  });

  it('calls it a duplicate as soon as any earlier record is still live', async () => {
    store.findCapture.mockResolvedValueOnce([{ id: 'a', kind: 'note', status: 'voided', payload: {}, missing_fields: [], version: 2 }]).mockResolvedValueOnce([{ id: 'b', kind: 'note', status: 'needs_info', payload: {}, missing_fields: ['text'], version: 1 }]);
    const res = await call(build(), { text: 'a note' });
    expect(res.json.duplicate).toBe(true);
    expect(res.json.records[0].id).toBe('b');
    expect(extract).not.toHaveBeenCalled();
  });

  it('stops trying to re-file after a few rejected attempts instead of looping', async () => {
    store.findCapture.mockResolvedValue([{ id: 'x', kind: 'note', status: 'rejected', payload: {}, missing_fields: [], version: 2 }]);
    const res = await call(build(), { text: 'again and again' });
    expect(res.statusCode).toBe(200);
    expect(res.json.duplicate).toBe(true);
    expect(store.findCapture.mock.calls.length).toBeLessThanOrEqual(5);
    expect(extract).not.toHaveBeenCalled();
  });

  it('hides database details when saving fails', async () => {
    store.insertRecords.mockRejectedValue(Object.assign(new Error('permission denied for table records (secret detail)'), { code: '42501' }));
    const res = await call(build(), { text: 'sprayed B2' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('capture handler — keeping the source file', () => {
  it('stores the photo privately and links it from every record it produced', async () => {
    extract.mockResolvedValue(extraction([completeSpray, incompleteSeed]));
    const res = await call(build(), { text: 'x', attachments: [image('AAAA')] });
    const args = store.uploadAttachments.mock.calls[0][0];
    expect(args.farmId).toBe(FARM_ID);
    expect(args.captureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.attachments).toHaveLength(1);
    const rows = store.insertRecords.mock.calls[0][0];
    expect(rows.map((r) => r.attachments)).toEqual([[{ path: 'farm/hash/0.jpg', media_type: 'image/jpeg', bytes: 3 }], [{ path: 'farm/hash/0.jpg', media_type: 'image/jpeg', bytes: 3 }]]);
    expect(res.json.records[0].attachments).toEqual([{ path: 'farm/hash/0.jpg', media_type: 'image/jpeg', bytes: 3 }]);
    expect(res.json.warnings).toEqual([]);
  });

  it('uploads nothing for a text-only message', async () => {
    await call(build(), { text: 'sprayed' });
    expect(store.uploadAttachments).not.toHaveBeenCalled();
    expect(store.insertRecords.mock.calls[0][0][0].attachments).toEqual([]);
  });

  it('uploads nothing when the photo produced no record or was refused', async () => {
    extract.mockResolvedValue(extraction([], { message: 'not a record' }));
    await call(build(), { attachments: [image()] });
    extract.mockResolvedValue(extraction([completeSpray], { refused: true }));
    await call(build(), { attachments: [image('BBBB')] });
    expect(store.uploadAttachments).not.toHaveBeenCalled();
  });

  it('still saves the records, with a warning, when the file cannot be stored', async () => {
    store.uploadAttachments.mockRejectedValue(new Error('storage down secret detail'));
    const res = await call(build(), { attachments: [image()] });
    expect(res.statusCode).toBe(200);
    expect(res.json.records).toHaveLength(1);
    expect(res.json.warnings).toEqual(['files_not_saved']);
    expect(store.insertRecords.mock.calls[0][0][0].attachments).toEqual([]);
    expect(res.body).not.toContain('secret detail');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('capture handler — nothing to save', () => {
  it('returns the model’s words and saves nothing when no record was found', async () => {
    extract.mockResolvedValue(extraction([], { message: 'That looks like a landscape photo, not a farm record.' }));
    const res = await call(build(), { attachments: [image()] });
    expect(res.statusCode).toBe(200);
    expect(res.json.records).toEqual([]);
    expect(res.json.message).toMatch(/landscape/);
    expect(store.insertRecords).not.toHaveBeenCalled();
  });

  it('reports a refusal and saves nothing', async () => {
    extract.mockResolvedValue(extraction([completeSpray], { refused: true }));
    const res = await call(build(), { text: 'x' });
    expect(res.json.refused).toBe(true);
    expect(res.json.records).toEqual([]);
    expect(store.insertRecords).not.toHaveBeenCalled();
  });

  it('flags truncated and over-long answers so the UI can say so', async () => {
    extract.mockResolvedValue(extraction([completeSpray], { truncated: true, tooMany: true, skippedProposals: 2 }));
    const res = await call(build(), { text: 'x' });
    expect(res.json).toMatchObject({ truncated: true, tooMany: true, skipped: 2 });
    expect(res.json.records).toHaveLength(1);
  });
});

describe('capture handler — upstream failures', () => {
  it('503s when no API key is configured, without calling the model', async () => {
    const res = await call(build({ getAnthropic: () => null }), { text: 'x' });
    expect(res.statusCode).toBe(503);
    expect(extract).not.toHaveBeenCalled();
  });

  it('maps upstream errors to safe messages and saves nothing', async () => {
    const err = Anthropic.APIError.generate(429, { type: 'error', error: { type: 'x', message: 'org quota sk-ant-SECRET' } }, 'org quota sk-ant-SECRET', new Headers({ 'retry-after': '7' }));
    extract.mockRejectedValue(err);
    const res = await call(build(), { text: 'x' });
    expect(res.statusCode).toBe(429);
    expect(res.getHeader('retry-after')).toBe('7');
    expect(res.body).not.toContain('SECRET');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk-ant-SECRET');
    expect(store.insertRecords).not.toHaveBeenCalled();
  });
});

describe('capture handler — the farm’s fields', () => {
  it('tells the extractor the farm’s field names, read as the caller for the caller’s farm', async () => {
    store.listFieldNames = vi.fn(async () => ['B2', 'North 40']);
    const res = await call(build(), { text: 'sprayed b2' });
    expect(res.statusCode).toBe(200);
    expect(store.listFieldNames).toHaveBeenCalledWith('good-token', { farmId: FARM_ID });
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ fieldNames: ['B2', 'North 40'] }));
  });

  it('cleans the names before the extractor sees them', async () => {
    store.listFieldNames = vi.fn(async () => [' B2 ', 'b2', null, 'x'.repeat(100)]);
    await call(build(), { text: 'sprayed b2' });
    expect(extract.mock.calls[0][0].fieldNames).toEqual(['B2']);
  });

  it('still files the records, without names, when the list cannot be read (and says so without the details)', async () => {
    store.listFieldNames = vi.fn(async () => { throw new Error('db down'); });
    const res = await call(build(), { text: 'sprayed b2' });
    expect(res.statusCode).toBe(200);
    expect(res.json.records).toHaveLength(1);
    expect(extract.mock.calls[0][0].fieldNames).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('works with a store that has no field list', async () => {
    const res = await call(build(), { text: 'sprayed b2' });
    expect(res.statusCode).toBe(200);
    expect(extract.mock.calls[0][0].fieldNames).toEqual([]);
  });

  it('does not read the list for a capture it already filed', async () => {
    store.listFieldNames = vi.fn(async () => ['B2']);
    store.findCapture.mockResolvedValue([{ id: 'r1', kind: 'activity', status: 'pending_review', record_date: '2026-10-11', payload: {}, missing_fields: [], version: 1 }]);
    const res = await call(build(), { text: 'sprayed b2' });
    expect(res.json.duplicate).toBe(true);
    expect(store.listFieldNames).not.toHaveBeenCalled();
  });
});
