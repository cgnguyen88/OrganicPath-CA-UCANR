import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { createChannelHandler } from './channelCore.js';
import { TelegramApiError } from './telegramApi.js';
import { CHANNEL_TEXT } from './channelText.js';
import { fieldLabel } from '../../../src/domain/records/labels.js';

const labels = (kind, keys, lang = 'en') => keys.map((k) => fieldLabel(kind, k, lang, 'Date')).join(', ');

const FARM = '11111111-1111-4111-8111-111111111111';
const IDENTITY = { identityId: 'i1', userId: 'u1', farmId: FARM, lang: 'en', role: 'crew' };
const CODE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const hashOf = (code) => createHash('sha256').update(code).digest('hex');
const T = CHANNEL_TEXT;

const config = { agent: { model: 'm', maxTokens: 100, effort: 'medium', strictTools: false, requestTimeoutMs: 1000, timeZone: 'America/Los_Angeles', limits: { maxTextChars: 8000 } } };

const completeSpray = { kind: 'activity', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B2', product: 'Neem', rate: '2 oz/gal', target: 'aphids' }, confidence: 0.9, missing: [], errors: {}, complete: true, dropped: [] };
const incompleteSeed = { kind: 'seed', record_date: null, payload: { crop: 'Tomato' }, confidence: 0.6, missing: ['record_date', 'supplier'], errors: {}, complete: false, dropped: [] };
const extraction = (proposals = [], extra = {}) => ({ proposals, message: '', usage: { input_tokens: 10, output_tokens: 5 }, model: 'm', refused: false, truncated: false, ignoredToolCalls: 0, skippedProposals: 0, tooMany: false, ...extra });

const update = (over = {}) => ({
  updateId: 1, userId: '555', chatId: '555', messageId: 70, text: '', command: null, commandArg: '', replyToMessageId: null, displayName: 'Maria (@maria)', languageCode: 'en',
  files: [], unsupported: null, tooLarge: false, ...over,
});
const photo = { fileId: 'file-1', kind: 'photo', mimeType: 'image/jpeg', size: 1000 };
const allow = () => ({ check: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })) });
const block = (s = 30) => ({ check: vi.fn(async () => ({ allowed: false, retryAfterSec: s })) });

const openRecord = (over = {}) => ({ id: 'r-open', farm_id: FARM, kind: 'activity', status: 'needs_info', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B4' }, missing_fields: ['product', 'rate', 'target'], confidence: 0.8, version: 2, created_by: 'u1', attachments: [], ...over });
const replyResult = (over = {}) => ({
  record: { kind: 'activity', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B4', product: 'Bt', rate: '1 oz/gal', target: 'caterpillars' } },
  evaluation: { ok: true, complete: true, missing: [], value: { record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B4', product: 'Bt', rate: '1 oz/gal', target: 'caterpillars' } } },
  applied: ['product', 'rate', 'target'], rejected: [], message: '', usage: { input_tokens: 5, output_tokens: 2 }, ...over,
});

let telegram; let store; let extract; let reply; let logger; let sent; let limits;

function build(over = {}) {
  return createChannelHandler({
    config, store, telegram, getAnthropic: () => ({ fake: true }), extract, reply, logger,
    limiters: limits, today: () => '2026-10-13', now: () => Date.parse('2026-10-13T12:00:00Z'), ...over,
  });
}

beforeEach(() => {
  sent = [];
  let nextId = 1000;
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  telegram = {
    sendMessage: vi.fn(async (m) => { sent.push(m); nextId += 1; return { messageId: nextId }; }),
    sendChatAction: vi.fn(async () => {}),
    downloadFile: vi.fn(async () => Buffer.from('IMG')),
  };
  store = {
    consumeLinkCode: vi.fn(async () => ({ userId: 'u1', farmId: FARM, lang: 'es', farmName: 'Sunny Acres', ownerHint: 'a***@example.com' })),
    resolvePending: vi.fn(async () => null),
    confirmIdentity: vi.fn(async () => true),
    resolveIdentity: vi.fn(async () => IDENTITY),
    setLang: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    rememberMessage: vi.fn(async () => {}),
    recordForMessage: vi.fn(async () => null),
    latestOpenRecord: vi.fn(async () => null),
    findCapture: vi.fn(async () => []),
    insertRecords: vi.fn(async (rows) => rows.map((r, i) => ({ ...r, id: `rec-${i}`, version: 1 }))),
    uploadAttachments: vi.fn(async ({ attachments }) => attachments.map((a, i) => ({ path: `f/h/${i}.jpg`, media_type: a.source.media_type, bytes: 3 }))),
    updateRecord: vi.fn(async (_u, id, version, patch) => ({ ok: true, row: { ...openRecord({ id, version: version + 1 }), ...patch } })),
  };
  extract = vi.fn(async () => extraction([completeSpray]));
  reply = vi.fn(async () => replyResult());
  limits = { chat: { minuteLimiter: allow(), dayLimiter: allow(), globalLimiter: allow() }, stranger: allow(), linking: allow() };
});

const run = (u, over) => build(over)(u);
const texts = () => sent.map((m) => m.text);

describe('people who are not linked', () => {
  beforeEach(() => store.resolveIdentity.mockResolvedValue(null));

  it('are told how to connect, in their Telegram language, and nothing else happens', async () => {
    await run(update({ text: 'Sprayed neem', languageCode: 'es-419' }));
    expect(texts()).toEqual([T.es.notLinked]);
    expect(extract).not.toHaveBeenCalled();
    expect(store.insertRecords).not.toHaveBeenCalled();
    expect(telegram.downloadFile).not.toHaveBeenCalled();
  });

  it('get English when their language is not Spanish', async () => {
    await run(update({ text: 'hi', languageCode: 'fr' }));
    expect(texts()).toEqual([T.en.notLinked]);
  });

  it('are answered only a few times, so a stranger cannot make the bot spam or cost money', async () => {
    limits.stranger = block();
    await run(update({ text: 'hi' }));
    expect(sent).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('cannot use commands or files either', async () => {
    await run(update({ command: 'help' }));
    await run(update({ files: [photo] }));
    expect(texts()).toEqual([T.en.notLinked, T.en.notLinked]);
    expect(telegram.downloadFile).not.toHaveBeenCalled();
  });
});

describe('linking with /start', () => {
  beforeEach(() => store.resolveIdentity.mockResolvedValue(null));

  it('asks the Telegram user to confirm WHICH farm they are joining, in the language chosen in the app, before anything is active', async () => {
    await run(update({ command: 'start', commandArg: CODE }));
    expect(store.consumeLinkCode).toHaveBeenCalledWith('telegram', hashOf(CODE), '555', 'Maria (@maria)');
    expect(texts()).toEqual([T.es.confirmPrompt('Sunny Acres', 'a***@example.com')]);
    expect(texts()[0]).toContain('Sunny Acres');
    expect(texts()[0]).toContain('a***@example.com');
    expect(store.confirmIdentity).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it.each([['a short code', 'abc'], ['a code with odd characters', `${CODE.slice(1)}!`], ['uppercase hex', CODE.toUpperCase()], ['a very long code', 'a'.repeat(500)], ['nothing', '']])('does not even look up %s', async (_n, arg) => {
    await run(update({ command: 'start', commandArg: arg }));
    expect(store.consumeLinkCode).not.toHaveBeenCalled();
    expect(texts()).toEqual([arg === '' ? T.en.notLinked : T.en.linkFailed]);
  });

  it('says so when the code is unknown, used or expired', async () => {
    store.consumeLinkCode.mockResolvedValue(null);
    await run(update({ command: 'start', commandArg: CODE }));
    expect(texts()).toEqual([T.en.linkFailed]);
  });

  it('limits how often one Telegram account can try codes', async () => {
    limits.linking = block();
    await run(update({ command: 'start', commandArg: CODE }));
    expect(store.consumeLinkCode).not.toHaveBeenCalled();
    expect(texts()).toEqual([T.en.linkFailed]);
  });

  it('tells someone already connected that they are', async () => {
    store.resolveIdentity.mockResolvedValue(IDENTITY);
    await run(update({ command: 'start', commandArg: '' }));
    expect(texts()).toEqual([T.en.alreadyLinked]);
  });
});

describe('confirming a link', () => {
  beforeEach(() => {
    store.resolveIdentity.mockResolvedValue(null);
    store.resolvePending.mockResolvedValue({ identityId: 'pend-1', lang: 'es' });
  });

  it.each(['yes', 'YES', ' Yes ', 'y', 'si', 'sí', 'SÍ', 'Sí.', 'confirm'])('connects the chat when they answer %j', async (word) => {
    await run(update({ text: word }));
    expect(store.confirmIdentity).toHaveBeenCalledWith('telegram', '555');
    expect(texts()).toEqual([T.es.linked]);
  });

  it.each(['no', 'NO', 'n', 'cancel', 'cancelar'])('cancels the pending link when they answer %j, and connects nothing', async (word) => {
    await run(update({ text: word }));
    expect(store.unlink).toHaveBeenCalledWith('pend-1');
    expect(store.confirmIdentity).not.toHaveBeenCalled();
    expect(texts()).toEqual([T.es.cancelled]);
  });

  it('says the link has expired if the confirmation no longer works', async () => {
    store.confirmIdentity.mockResolvedValue(false);
    await run(update({ text: 'yes' }));
    expect(texts()).toEqual([T.es.linkFailed]);
  });

  it('reminds them what to answer if they say anything else, and does nothing else', async () => {
    await run(update({ text: 'Sprayed neem on B2' }));
    expect(texts()).toEqual([T.es.confirmHint]);
    expect(store.confirmIdentity).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('only looks at recent pending links', async () => {
    await run(update({ text: 'yes' }));
    expect(store.resolvePending).toHaveBeenCalledWith('telegram', '555', '2026-10-13T11:45:00.000Z');
  });

  it('lets a new /start code replace a pending link', async () => {
    await run(update({ command: 'start', commandArg: CODE }));
    expect(store.consumeLinkCode).toHaveBeenCalled();
    expect(texts()[0]).toContain('Sunny Acres');
  });

  it('a stranger’s plain yes does nothing when no link is pending', async () => {
    store.resolvePending.mockResolvedValue(null);
    await run(update({ text: 'yes' }));
    expect(store.confirmIdentity).not.toHaveBeenCalled();
    expect(texts()).toEqual([T.en.notLinked]);
  });
});

describe('commands from a linked person', () => {
  it('/help shows the help in their language', async () => {
    store.resolveIdentity.mockResolvedValue({ ...IDENTITY, lang: 'es' });
    await run(update({ command: 'help' }));
    expect(texts()).toEqual([T.es.help]);
  });

  it('/lang changes the language and confirms in the new one', async () => {
    await run(update({ command: 'lang', commandArg: 'es' }));
    expect(store.setLang).toHaveBeenCalledWith('i1', 'es');
    expect(texts()).toEqual([T.es.langSet.es]);
  });

  it('/lang with anything else explains the choices and changes nothing', async () => {
    await run(update({ command: 'lang', commandArg: 'klingon' }));
    expect(store.setLang).not.toHaveBeenCalled();
    expect(texts()).toEqual([T.en.langUsage]);
  });

  it('/stop disconnects this chat', async () => {
    await run(update({ command: 'stop' }));
    expect(store.unlink).toHaveBeenCalledWith('i1');
    expect(texts()).toEqual([T.en.stopped]);
  });

  it('an unknown command points to /help, and costs nothing', async () => {
    await run(update({ command: 'frobnicate' }));
    expect(texts()).toEqual([T.en.unknownCommand]);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe('what the bot cannot read', () => {
  it.each(['voice', 'audio', 'video', 'sticker', 'document'])('explains that %s is not supported, without a model call', async (kind) => {
    await run(update({ unsupported: kind }));
    expect(texts()).toEqual([T.en.unsupported[kind]]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('explains a file that is too large', async () => {
    await run(update({ tooLarge: true }));
    expect(texts()).toEqual([T.en.fileTooLarge]);
    expect(telegram.downloadFile).not.toHaveBeenCalled();
  });
});

describe('limits on a linked person', () => {
  it('asks them to slow down when over their own limit, before any download or model call', async () => {
    limits.chat.minuteLimiter = block(20);
    await run(update({ text: 'Sprayed neem' }));
    expect(texts()).toEqual([T.en.rateLimited]);
    expect(extract).not.toHaveBeenCalled();
    expect(telegram.downloadFile).not.toHaveBeenCalled();
  });

  it('says the assistant is busy when everyone combined is over the daily cap', async () => {
    limits.chat.globalLimiter = block(3600);
    await run(update({ text: 'Sprayed neem' }));
    expect(texts()).toEqual([T.en.busy]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('does not count commands against the limit', async () => {
    limits.chat.minuteLimiter = block();
    await run(update({ command: 'help' }));
    expect(texts()).toEqual([T.en.help]);
  });
});

describe('capturing a photo or text', () => {
  it('reads the photo and files the records for review, attributed to the linked person and farm', async () => {
    extract.mockResolvedValue(extraction([completeSpray, incompleteSeed]));
    await run(update({ files: [photo], text: 'receipt' }));

    expect(telegram.sendChatAction).toHaveBeenCalledWith({ chatId: '555' });
    expect(telegram.downloadFile).toHaveBeenCalledWith('file-1', { maxBytes: expect.any(Number) });
    const input = extract.mock.calls[0][0].input;
    expect(input.text).toBe('receipt');
    expect(input.attachments).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('IMG').toString('base64') } }]);
    expect(extract.mock.calls[0][0].today).toBe('2026-10-13');

    const rows = store.insertRecords.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.farm_id === FARM && r.created_by === 'u1' && r.source === 'telegram')).toBe(true);
    expect(rows.map((r) => r.status)).toEqual(['pending_review', 'needs_info']);
    expect(rows.map((r) => r.status)).not.toContain('approved');
    expect(rows[0].source_ref).toMatch(/^[0-9a-f]{64}#0$/);
  });

  it('sends a summary, then one question message per incomplete record, and remembers which record each asks about', async () => {
    extract.mockResolvedValue(extraction([completeSpray, incompleteSeed]));
    await run(update({ files: [photo] }));
    const [summary, question] = texts();
    expect(summary).toContain('Filed 2 records for review ✅');
    expect(summary).toContain('• Spray · B2 · Neem (2026-10-11)');
    expect(question).toContain('I need a few details');
    expect(question).toContain('Reply to this message');
    expect(sent).toHaveLength(2);
    // The question's message id (1002) is linked to the incomplete record (rec-1).
    expect(store.rememberMessage).toHaveBeenCalledTimes(1);
    expect(store.rememberMessage).toHaveBeenCalledWith('telegram', '555', 1002, 'rec-1');
  });

  it('keeps the original photo with the records', async () => {
    await run(update({ files: [photo] }));
    expect(store.uploadAttachments).toHaveBeenCalledWith({ farmId: FARM, captureHash: expect.stringMatching(/^[0-9a-f]{64}$/), attachments: expect.any(Array) });
    expect(store.insertRecords.mock.calls[0][0][0].attachments).toEqual([{ path: 'f/h/0.jpg', media_type: 'image/jpeg', bytes: 3 }]);
  });

  it('sends a PDF as a document block', async () => {
    await run(update({ files: [{ fileId: 'd', kind: 'document', mimeType: 'application/pdf', size: 10 }] }));
    expect(extract.mock.calls[0][0].input.attachments[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
  });

  it('files plain text too', async () => {
    await run(update({ text: 'Sprayed neem on B2 yesterday' }));
    expect(extract.mock.calls[0][0].input).toEqual({ text: 'Sprayed neem on B2 yesterday', attachments: [] });
    expect(texts()[0]).toContain('Filed 1 record for review ✅');
  });

  it('answers in the language chosen for the account', async () => {
    store.resolveIdentity.mockResolvedValue({ ...IDENTITY, lang: 'es' });
    await run(update({ text: 'Apliqué neem' }));
    expect(texts()[0]).toContain('Archivé 1 registro para revisión ✅');
  });

  it('recognises a repeat and says what was already filed, without another model call', async () => {
    store.findCapture.mockResolvedValue([{ id: 'old', kind: 'activity', status: 'pending_review', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B2' }, missing_fields: [], version: 1 }]);
    await run(update({ text: 'Sprayed neem' }));
    expect(extract).not.toHaveBeenCalled();
    expect(texts()[0]).toContain(T.en.duplicate);
    expect(texts()[0]).toContain('Spray · B2');
  });

  it('says what it found when there was no record, passing on the assistant’s own words', async () => {
    extract.mockResolvedValue(extraction([], { message: 'That looks like a landscape.' }));
    await run(update({ files: [photo] }));
    expect(texts()).toEqual([`${T.en.nothingFound}\n\nThat looks like a landscape.`]);
    expect(store.insertRecords).not.toHaveBeenCalled();
  });

  it('says so when the assistant refused', async () => {
    extract.mockResolvedValue(extraction([completeSpray], { refused: true }));
    await run(update({ text: 'x' }));
    expect(texts()[0]).toContain(T.en.refused);
    expect(store.insertRecords).not.toHaveBeenCalled();
  });

  it('adds notices for cut-short, capped, skipped and unsaved-photo cases', async () => {
    extract.mockResolvedValue(extraction([completeSpray], { truncated: true, tooMany: true, skippedProposals: 2 }));
    store.uploadAttachments.mockRejectedValue(new Error('storage down'));
    await run(update({ files: [photo] }));
    const first = texts()[0];
    for (const note of [T.en.truncated, T.en.tooMany, T.en.skipped(2), T.en.filesNotSaved]) expect(first).toContain(note);
  });
});

describe('when something goes wrong while capturing', () => {
  it('apologises plainly if the file cannot be fetched, or is too large for the bot to fetch', async () => {
    telegram.downloadFile.mockRejectedValueOnce(new TelegramApiError('downloadFile', 'network', 'could not reach Telegram'));
    await run(update({ files: [photo] }));
    telegram.downloadFile.mockRejectedValueOnce(new TelegramApiError('downloadFile', 'too_large', 'file is too large'));
    await run(update({ files: [photo], updateId: 2 }));
    expect(texts()).toEqual([T.en.downloadFailed, T.en.fileTooLarge]);
    expect(extract).not.toHaveBeenCalled();
  });

  it.each([[429, 'busy'], [529, 'busy'], [500, 'unavailable']])('maps a model error %i to a friendly message and saves nothing', async (status, key) => {
    extract.mockRejectedValue(Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'quota sk-ant-SECRET' } }, 'quota sk-ant-SECRET', new Headers()));
    await run(update({ text: 'x' }));
    expect(texts()).toEqual([T[key === 'busy' ? 'en' : 'en'][key]]);
    expect(store.insertRecords).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk-ant-SECRET');
  });

  it('says the assistant is unavailable when no API key is configured', async () => {
    await run(update({ text: 'x' }), { getAnthropic: () => null });
    expect(texts()).toEqual([T.en.unavailable]);
  });

  it('reports a database failure generically, without details', async () => {
    store.insertRecords.mockRejectedValue(Object.assign(new Error('permission denied for table records (secret detail)'), { code: '42501' }));
    await run(update({ text: 'x' }));
    expect(texts()).toEqual([T.en.error]);
    expect(texts().join()).not.toContain('secret detail');
  });

  it('still answers if something unexpected is thrown, and never logs what the person wrote or a secret key', async () => {
    store.resolveIdentity.mockRejectedValue(new Error('request failed for key sk-ant-SECRET123'));
    await run(update({ text: 'my private farm note' }));
    expect(texts()).toEqual([T.en.error]);
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/sk-ant-SECRET123|my private farm note/);
  });

  it('does not throw even if Telegram refuses to deliver the apology', async () => {
    store.resolveIdentity.mockRejectedValue(new Error('boom'));
    telegram.sendMessage.mockRejectedValue(new TelegramApiError('sendMessage', 403, 'Forbidden: bot was blocked by the user'));
    await expect(run(update({ text: 'x' }))).resolves.toBeDefined();
  });
});

describe('answering a question', () => {
  it('applies the answer to the record the replied-to message asked about, and says it is complete', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    await run(update({ text: 'Bt, 1 oz per gallon, caterpillars', replyToMessageId: 1002 }));

    expect(store.recordForMessage).toHaveBeenCalledWith({ provider: 'telegram', chatId: '555', messageId: 1002, userId: 'u1', farmId: FARM });
    const args = reply.mock.calls[0][0];
    expect(args.draft).toEqual({ kind: 'activity', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B4' } });
    expect(args.allowedKeys).toEqual(['product', 'rate', 'target']);
    expect(args.replyText).toBe('Bt, 1 oz per gallon, caterpillars');

    expect(store.updateRecord).toHaveBeenCalledWith('u1', FARM, 'r-open', 2, expect.objectContaining({ status: 'pending_review', missing_fields: [] }));
    expect(texts()).toEqual([`${T.en.replyDone('Spray · B4 · Bt')}\n${T.en.updated(labels('activity', ['product', 'rate', 'target']))}`]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('never lets an answer approve anything', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    await run(update({ text: 'ok', replyToMessageId: 1002 }));
    expect(store.updateRecord.mock.calls[0][4].status).not.toBe('approved');
    expect(Object.keys(store.updateRecord.mock.calls[0][4]).sort()).toEqual(['fingerprint', 'missing_fields', 'payload', 'record_date', 'status']);
  });

  it('asks the rest, in a new message linked to the same record, when the answer is only partial', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({
      evaluation: { ok: true, complete: false, missing: ['rate', 'target'], value: { record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B4', product: 'Bt' } } },
      applied: ['product'],
    }));
    store.updateRecord.mockResolvedValue({ ok: true, row: openRecord({ version: 3, payload: { activity_type: 'spray', field: 'B4', product: 'Bt' }, missing_fields: ['rate', 'target'] }) });
    await run(update({ text: 'Bt', replyToMessageId: 1002 }));
    expect(texts()[0]).toContain('still needs');
    expect(texts()[0]).toContain('mix rate');
    expect(store.rememberMessage).toHaveBeenCalledWith('telegram', '555', expect.any(Number), 'r-open');
  });

  it('reports values it could not use', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({ rejected: ['rate'] }));
    await run(update({ text: 'Bt, lots', replyToMessageId: 1002 }));
    expect(texts().join('\n')).toContain('I could not use:');
  });

  it('says so, and changes nothing, when the answer held nothing usable', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({ applied: [], message: 'Which product was it?' }));
    await run(update({ text: 'um', replyToMessageId: 1002 }));
    expect(store.updateRecord).not.toHaveBeenCalled();
    expect(texts()).toEqual([`${T.en.replyNothing}\n\nWhich product was it?`]);
    expect(extract).not.toHaveBeenCalled(); // an explicit reply is never turned into a new record
  });

  it('tells them when the record changed or was already reviewed, instead of overwriting', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    store.updateRecord.mockResolvedValue({ ok: false, reason: 'conflict' });
    await run(update({ text: 'Bt', replyToMessageId: 1002 }));
    expect(texts()).toEqual([T.en.recordChanged]);
  });

  it('will not change a record that is no longer waiting for details', async () => {
    store.recordForMessage.mockResolvedValue(openRecord({ status: 'pending_review', missing_fields: [] }));
    await run(update({ text: 'Bt', replyToMessageId: 1002 }));
    expect(reply).not.toHaveBeenCalled();
    expect(store.updateRecord).not.toHaveBeenCalled();
    expect(texts()).toEqual([T.en.recordNotEditable]);
  });

  it('treats a reply to an unknown message like ordinary text', async () => {
    store.recordForMessage.mockResolvedValue(null);
    await run(update({ text: 'Sprayed neem on B2', replyToMessageId: 999 }));
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('uses the latest open question when a plain message answers it', async () => {
    store.latestOpenRecord.mockResolvedValue(openRecord());
    await run(update({ text: 'Bt, 1 oz per gallon, caterpillars' }));
    expect(store.latestOpenRecord).toHaveBeenCalledWith({ userId: 'u1', farmId: FARM, since: '2026-10-12T12:00:00.000Z' });
    expect(store.updateRecord).toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('files a plain message as a NEW record when it does not answer the open question', async () => {
    store.latestOpenRecord.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({ applied: [] }));
    await run(update({ text: 'Harvested 40 boxes of romaine from block 3' }));
    expect(store.updateRecord).not.toHaveBeenCalled();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(texts()[0]).toContain('Filed 1 record for review ✅');
  });

  it('a new photo is always a new capture, even with a question open', async () => {
    store.latestOpenRecord.mockResolvedValue(openRecord());
    await run(update({ files: [photo] }));
    expect(reply).not.toHaveBeenCalled();
    expect(extract).toHaveBeenCalledTimes(1);
  });
});

describe('naming what an answer changed', () => {
  it('lists the fields it updated, so a wrongly matched answer is noticed', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({ applied: ['product'], evaluation: { ok: true, complete: false, missing: ['rate', 'target'], value: { record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B4', product: 'Bt' } } } }));
    store.updateRecord.mockResolvedValue({ ok: true, row: openRecord({ version: 3, payload: { activity_type: 'spray', field: 'B4', product: 'Bt' }, missing_fields: ['rate', 'target'] }) });
    await run(update({ text: 'Bt', replyToMessageId: 1002 }));
    expect(texts()[0]).toContain(T.en.updated(labels('activity', ['product'])));
  });

  it('says it in Spanish too', async () => {
    store.resolveIdentity.mockResolvedValue({ ...IDENTITY, lang: 'es' });
    store.recordForMessage.mockResolvedValue(openRecord());
    await run(update({ text: 'Bt, 1 oz', replyToMessageId: 1002 }));
    expect(texts()[0]).toMatch(/^Gracias/);
    expect(texts()[0]).toContain('Actualizado:');
  });
});

describe('what the assistant says is shown as plain text', () => {
  it('removes links, @mentions and tappable commands from model prose before relaying it', async () => {
    extract.mockResolvedValue(extraction([], { message: 'Visit https://evil.example/x or www.evil.example or t.me/scam, ask @attacker, then tap /stop now' }));
    await run(update({ files: [photo] }));
    const out = texts()[0];
    expect(out).not.toMatch(/https?:|www\.|t\.me|evil\.example|@attacker|\/stop/);
    expect(out).toContain(T.en.nothingFound);
  });

  it('does the same for the model’s words in an answer', async () => {
    store.recordForMessage.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({ applied: [], message: 'Open https://evil.example then /stop' }));
    await run(update({ text: 'um', replyToMessageId: 1002 }));
    expect(texts()[0]).not.toMatch(/https?:|evil\.example|\/stop/);
  });

  it('removes bare domains too, which Telegram would also make tappable', async () => {
    extract.mockResolvedValue(extraction([], { message: 'Pay at pay-now.com or bit.ly/abc123 or my-farm.co/x today.' }));
    await run(update({ files: [photo] }));
    expect(texts()[0]).not.toMatch(/pay-now|bit\.ly|my-farm/);
  });

  it('keeps ordinary prose intact', async () => {
    extract.mockResolvedValue(extraction([], { message: 'That looks like a landscape photo, not a receipt.' }));
    await run(update({ files: [photo] }));
    expect(texts()[0]).toContain('That looks like a landscape photo, not a receipt.');
  });

  it('cuts very long model prose', async () => {
    extract.mockResolvedValue(extraction([], { message: 'word '.repeat(500) }));
    await run(update({ files: [photo] }));
    expect(texts()[0].length).toBeLessThan(700);
  });
});

describe('one message, one charge per model call', () => {
  it('charges again when a plain message was first tried as an answer and then filed as new', async () => {
    store.latestOpenRecord.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({ applied: [] }));
    await run(update({ text: 'Harvested 40 boxes of romaine' }));
    expect(limits.chat.minuteLimiter.check).toHaveBeenCalledTimes(2);
  });

  it('stops after the answer attempt if that used up the allowance', async () => {
    store.latestOpenRecord.mockResolvedValue(openRecord());
    reply.mockResolvedValue(replyResult({ applied: [] }));
    limits.chat.minuteLimiter = { check: vi.fn().mockResolvedValueOnce({ allowed: true, retryAfterSec: 0 }).mockResolvedValue({ allowed: false, retryAfterSec: 30 }) };
    await run(update({ text: 'Harvested 40 boxes of romaine' }));
    expect(extract).not.toHaveBeenCalled();
    expect(texts()).toEqual([T.en.rateLimited]);
  });

  it('charges once for an ordinary message', async () => {
    await run(update({ text: 'Sprayed neem on B2' }));
    expect(limits.chat.minuteLimiter.check).toHaveBeenCalledTimes(1);
  });
});

describe('the farm’s fields', () => {
  it('are told to the model when a photo or message is read, for the linked farm', async () => {
    store.listFieldNames = vi.fn(async () => ['B2', 'North 40']);
    await run(update({ text: 'sprayed neem on b2' }));
    expect(store.listFieldNames).toHaveBeenCalledWith({ farmId: FARM });
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ fieldNames: ['B2', 'North 40'] }));
  });

  it('are told to the model when an answer to a question is read', async () => {
    store.listFieldNames = vi.fn(async () => ['B4']);
    store.latestOpenRecord.mockResolvedValue(openRecord());
    await run(update({ text: 'Bt, 1 oz/gal, caterpillars' }));
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ fieldNames: ['B4'] }));
    expect(store.listFieldNames).toHaveBeenCalledWith({ farmId: FARM });
  });

  it('are left out, and the record still filed, when the list cannot be read', async () => {
    store.listFieldNames = vi.fn(async () => { throw new Error('db down'); });
    await run(update({ text: 'sprayed neem on b2' }));
    expect(extract.mock.calls[0][0].fieldNames).toEqual([]);
    expect(store.insertRecords).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('are simply not told when the store has no list', async () => {
    await run(update({ text: 'sprayed neem on b2' }));
    expect(extract.mock.calls[0][0].fieldNames).toEqual([]);
  });
});
