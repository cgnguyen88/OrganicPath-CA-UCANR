import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createTelegramHandler } from './createTelegramHandler.js';
import { createLimiterSet } from '../limiters.js';
import { makeReq, makeRes } from '../testHttp.js';

// A whole conversation, from raw Telegram JSON in to Telegram messages out. Only the outside world
// is faked: Telegram, the database and the model.

const SECRET = 'flow-secret_0123456789abcdef0123456789';
const FARM = '11111111-1111-4111-8111-111111111111';
const CODE = '0123456789abcdef0123456789abcdef';
const config = { allowedOrigins: [], agent: { model: 'm', maxTokens: 100, effort: 'medium', strictTools: false, requestTimeoutMs: 1000, timeZone: 'America/Los_Angeles', limits: {}, rate: { perMinute: 50, perDay: 500, globalPerDay: 5000 } } };

let sent; let db; let updateId; let model;

/** A small in-memory stand-in for the database behind the channel store. */
function memoryStore() {
  return {
    async claimUpdate(_p, id) { if (db.updates.has(id)) return false; db.updates.add(id); return true; },
    async consumeLinkCode(_p, hash, externalId) {
      const code = db.codes.get(hash);
      if (!code) return null;
      if (db.identities.get(externalId)?.confirmed) return null; // a connected chat is never taken over
      db.codes.delete(hash);
      db.identities.set(externalId, { identityId: `i-${externalId}`, userId: code.userId, farmId: FARM, lang: code.lang, role: 'crew', confirmed: false, linkedAt: Date.now() });
      return { userId: code.userId, farmId: FARM, lang: code.lang, farmName: 'Sunny Acres', ownerHint: 'o***@example.com' };
    },
    async resolvePending(_p, externalId) {
      const i = db.identities.get(externalId);
      return i && !i.confirmed ? { identityId: i.identityId, lang: i.lang } : null;
    },
    async confirmIdentity(_p, externalId) {
      const i = db.identities.get(externalId);
      if (!i || i.confirmed) return false;
      i.confirmed = true;
      return true;
    },
    async resolveIdentity(_p, externalId) { const i = db.identities.get(externalId); return i?.confirmed ? i : null; },
    async setLang(id, lang) { for (const i of db.identities.values()) if (i.identityId === id) i.lang = lang; },
    async unlink(id) { for (const [k, i] of db.identities) if (i.identityId === id) db.identities.delete(k); },
    async rememberMessage(_p, chat, messageId, recordId) { db.messages.set(`${chat}:${messageId}`, recordId); },
    async recordForMessage({ chatId, messageId, userId, farmId }) {
      const rec = db.records.find((r) => r.id === db.messages.get(`${chatId}:${messageId}`));
      return rec && rec.created_by === userId && rec.farm_id === farmId ? { ...rec } : null;
    },
    async latestOpenRecord({ userId, farmId }) {
      return [...db.records].reverse().find((r) => r.created_by === userId && r.farm_id === farmId && r.source === 'telegram' && r.status === 'needs_info') ?? null;
    },
    async findCapture({ farmId, captureHash }) { return db.records.filter((r) => r.farm_id === farmId && r.source_ref.startsWith(`${captureHash}#`)); },
    async insertRecords(rows) { const saved = rows.map((r) => ({ ...r, id: `rec-${db.records.length + 1}-${Math.random().toString(36).slice(2, 6)}`, version: 1 })); db.records.push(...saved); return saved; },
    async uploadAttachments({ attachments }) { return attachments.map((a, i) => ({ path: `f/${i}`, media_type: a.source.media_type, bytes: 3 })); },
    async updateRecord(actor, farmId, id, version, patch) {
      const rec = db.records.find((r) => r.id === id && r.farm_id === farmId && r.version === version && r.created_by === actor && ['draft', 'needs_info'].includes(r.status));
      if (!rec) return { ok: false, reason: 'conflict' };
      Object.assign(rec, patch, { version: rec.version + 1 });
      return { ok: true, row: { ...rec } };
    },
  };
}

function build() {
  const telegram = {
    sendMessage: vi.fn(async ({ chatId, text, replyToMessageId }) => { sent.push({ chatId, text, replyToMessageId }); return { messageId: 2000 + sent.length }; }),
    sendChatAction: vi.fn(async () => {}),
    downloadFile: vi.fn(async () => Buffer.from('JPEGBYTES')),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const limiters = createLimiterSet({ rate: config.agent.rate, prefix: 'agent', store: {}, shared: false, logger });
  const handler = createTelegramHandler({
    env: { TELEGRAM_WEBHOOK_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'k', TELEGRAM_BOT_TOKEN: '1:abcdefghij' },
    config, anthropic: { fake: true }, agentStore: {}, limiters, logger,
    overrides: { telegram, channelStore: memoryStore(), extract: model.extract, reply: model.reply },
  });
  return { handler, telegram, logger };
}

const message = (extra, from = 555) => ({ update_id: (updateId += 1), message: { message_id: 10 + updateId, date: 1_760_000_000, chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, language_code: 'en' }, ...extra } });
async function send(handler, update, secret = SECRET) {
  const res = makeRes();
  await handler(makeReq({ body: update, headers: { authorization: undefined, 'x-telegram-bot-api-secret-token': secret } }), res);
  return res;
}
const say = () => sent.map((m) => m.text);

beforeEach(() => {
  sent = []; updateId = 1000;
  db = { updates: new Set(), codes: new Map(), identities: new Map(), messages: new Map(), records: [] };
  db.codes.set(createHash('sha256').update(CODE).digest('hex'), { userId: 'u1', lang: 'en' });
  model = {
    extract: vi.fn(async () => ({
      proposals: [{ kind: 'activity', record_date: '2026-10-12', payload: { activity_type: 'spray', field: 'B4' }, confidence: 0.8, missing: ['product', 'rate', 'target'], errors: {}, complete: false, dropped: [] }],
      message: '', usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', refused: false, truncated: false, ignoredToolCalls: 0, skippedProposals: 0, tooMany: false,
    })),
    reply: vi.fn(async () => ({
      record: {}, applied: ['product', 'rate', 'target'], rejected: [], message: '', usage: { input_tokens: 1, output_tokens: 1 },
      evaluation: { ok: true, complete: true, missing: [], value: { record_date: '2026-10-12', payload: { activity_type: 'spray', field: 'B4', product: 'Bt', rate: '1 oz/gal', target: 'caterpillars' } } },
    })),
  };
});

describe('a whole conversation', () => {
  it('goes from a stranger, to linked, to a photo, to a question answered, to disconnected', async () => {
    const { handler, telegram } = build();

    // 1. A stranger is told how to connect, and nothing is read or saved.
    await send(handler, message({ text: 'hello?' }));
    expect(say()).toEqual([expect.stringContaining('Connect Telegram')]);
    expect(model.extract).not.toHaveBeenCalled();
    expect(db.records).toHaveLength(0);

    // 2. They open the link from the app. The bot says WHICH farm, and nothing is active yet.
    await send(handler, message({ text: `/start ${CODE}` }));
    expect(say().at(-1)).toContain('Sunny Acres');
    expect(db.identities.get('555')).toMatchObject({ userId: 'u1', farmId: FARM, confirmed: false });
    await send(handler, message({ text: 'sprayed neem on B2' })); // still a stranger: this is not read or filed
    expect(say().at(-1)).toMatch(/Reply YES/);
    expect(model.extract).not.toHaveBeenCalled();
    await send(handler, message({ text: 'YES' }));
    expect(say().at(-1)).toMatch(/Connected/);
    expect(db.identities.get('555').confirmed).toBe(true);
    await send(handler, message({ text: `/start ${CODE}` })); // the code cannot be used again
    expect(say().at(-1)).toMatch(/You are connected/);

    // 3. A photo with a caption is read and filed; the bot asks about what is missing.
    sent.length = 0;
    await send(handler, message({ caption: 'sprayed block 4', photo: [{ file_id: 'p1', file_unique_id: 'u', width: 800, height: 600, file_size: 50_000 }] }));
    expect(telegram.downloadFile).toHaveBeenCalledWith('p1', expect.any(Object));
    expect(db.records).toHaveLength(1);
    expect(db.records[0]).toMatchObject({ farm_id: FARM, created_by: 'u1', source: 'telegram', status: 'needs_info' });
    expect(say()[0]).toContain('Filed 1 record for review');
    const questionIndex = sent.findIndex((m) => m.text.includes('Reply to this message'));
    expect(questionIndex).toBeGreaterThan(-1);
    const questionMessageId = 2000 + questionIndex + 1;

    // 4. They answer by replying to the question: the record is completed and goes to review.
    sent.length = 0;
    await send(handler, message({ text: 'Bt, 1 oz per gallon, for caterpillars', reply_to_message: { message_id: questionMessageId } }));
    expect(db.records[0]).toMatchObject({ status: 'pending_review', missing_fields: [] });
    expect(db.records[0].payload.product).toBe('Bt');
    expect(say()[0]).toMatch(/completes it/);
    expect(say()[0]).toContain('Updated:');
    expect(db.records[0].status).not.toBe('approved');

    // 5. They disconnect; the next message is treated as a stranger's.
    await send(handler, message({ text: '/stop' }));
    expect(db.identities.size).toBe(0);
    sent.length = 0;
    await send(handler, message({ text: 'sprayed again' }));
    expect(say()).toEqual([expect.stringContaining('Connect Telegram')]);
    expect(db.records).toHaveLength(1);
  });

  it('does the work once even if Telegram delivers the same update twice', async () => {
    const { handler } = build();
    db.identities.set('555', { identityId: 'i1', userId: 'u1', farmId: FARM, lang: 'en', role: 'crew', confirmed: true });
    const update = message({ text: 'Sprayed neem on B4' });
    const first = await send(handler, update);
    const second = await send(handler, update);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(model.extract).toHaveBeenCalledTimes(1);
    expect(db.records).toHaveLength(1);
  });

  it('keeps two people’s conversations apart', async () => {
    const { handler } = build();
    db.identities.set('555', { identityId: 'i1', userId: 'u1', farmId: FARM, lang: 'en', role: 'crew', confirmed: true });
    db.identities.set('777', { identityId: 'i2', userId: 'u2', farmId: FARM, lang: 'en', role: 'crew', confirmed: true });
    await send(handler, message({ text: 'Sprayed neem on B4' }, 555));
    const questionId = 2000 + sent.findIndex((m) => m.text.includes('Reply to this message')) + 1;
    sent.length = 0;
    // The second person replies to the first person's question: it must not touch their record.
    await send(handler, message({ text: 'Bt', reply_to_message: { message_id: questionId } }, 777));
    expect(db.records[0].status).toBe('needs_info');
    expect(db.records[0].created_by).toBe('u1');
  });

  it('lets a Telegram user refuse a link they did not ask for, and nothing is connected', async () => {
    const { handler } = build();
    await send(handler, message({ text: `/start ${CODE}` }));
    await send(handler, message({ text: 'no' }));
    expect(say().at(-1)).toMatch(/Cancelled/);
    expect(db.identities.size).toBe(0);
    await send(handler, message({ text: 'sprayed neem' }));
    expect(say().at(-1)).toMatch(/Connect Telegram/);
    expect(db.records).toHaveLength(0);
  });

  it('cannot take over a chat that is already connected, even with a valid code from another farm', async () => {
    const { handler } = build();
    db.identities.set('555', { identityId: 'i1', userId: 'u1', farmId: FARM, lang: 'en', role: 'crew', confirmed: true });
    db.codes.set(createHash('sha256').update('b'.repeat(32)).digest('hex'), { userId: 'attacker', lang: 'en' });
    await send(handler, message({ text: `/start ${'b'.repeat(32)}` }));
    expect(db.identities.get('555')).toMatchObject({ userId: 'u1', confirmed: true });
  });

  it('rejects calls that do not carry Telegram’s secret', async () => {
    const { handler } = build();
    const res = await send(handler, message({ text: 'hi' }), 'wrong');
    expect(res.statusCode).toBe(401);
    expect(sent).toHaveLength(0);
  });
});

describe('rate limits', () => {
  it('shares the web app’s buckets, so connecting Telegram does not double anyone’s allowance', async () => {
    const takeRateToken = vi.fn(async () => ({ allowed: true, retry_after_sec: 0 }));
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const limiters = createLimiterSet({ rate: config.agent.rate, prefix: 'agent', store: { takeRateToken }, shared: true, logger });
    const handler = createTelegramHandler({
      env: { TELEGRAM_WEBHOOK_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'k', TELEGRAM_BOT_TOKEN: '1:abcdefghij' },
      config, anthropic: { fake: true }, agentStore: {}, limiters, logger,
      overrides: { telegram: { sendMessage: vi.fn(async () => ({ messageId: 1 })), sendChatAction: vi.fn(), downloadFile: vi.fn() }, channelStore: { ...memoryStore(), }, extract: model.extract, reply: model.reply },
    });
    db.identities.set('555', { identityId: 'i1', userId: 'u1', farmId: FARM, lang: 'en', role: 'crew', confirmed: true });
    await send(handler, message({ text: 'Sprayed neem on B4' }));
    const buckets = takeRateToken.mock.calls.map((c) => c[0]);
    expect(buckets).toContain('agent-capture-min');
    expect(buckets).toContain('agent-capture-day');
    expect(buckets).toContain('agent-global-day');
    expect(buckets.some((b) => b.includes('telegram-min') || b.includes('telegram-day'))).toBe(false);
  });
});

describe('createTelegramHandler configuration', () => {
  const baseDeps = (env) => ({ env, config, anthropic: null, agentStore: {}, limiters: createLimiterSet({ rate: config.agent.rate, prefix: 'agent', store: {}, shared: false, logger: console }), logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } });

  it.each([
    ['no webhook secret', { TELEGRAM_BOT_TOKEN: '1:abcdefghij', SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['no bot token', { TELEGRAM_WEBHOOK_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['a malformed bot token', { TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_TOKEN: 'nope', SUPABASE_SERVICE_ROLE_KEY: 'k' }],
    ['no service-role key', { TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_TOKEN: '1:abcdefghij' }],
    ['a webhook secret that is too short to be safe', { TELEGRAM_WEBHOOK_SECRET: 'short-secret-123', TELEGRAM_BOT_TOKEN: '1:abcdefghij', SUPABASE_SERVICE_ROLE_KEY: 'k' }],
  ])('refuses every request, with a logged reason, when there is %s', async (_n, env) => {
    const deps = baseDeps(env);
    const handler = createTelegramHandler(deps);
    const res = await send(handler, message({ text: 'hi' }));
    expect(res.statusCode).toBe(503);
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringMatching(/disabled/));
  });

  it('stays quiet in the log when Telegram was never set up at all', () => {
    const deps = baseDeps({});
    createTelegramHandler(deps);
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });
});
