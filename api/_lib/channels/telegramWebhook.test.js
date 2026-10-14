import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTelegramWebhookHandler, safeEqual } from './telegramWebhook.js';
import { makeReq, makeRes } from '../testHttp.js';

const SECRET = 'whsec_AbC-123_xyz';
const body = (over = {}) => ({ update_id: 500, message: { message_id: 7, chat: { id: 555, type: 'private' }, from: { id: 555, is_bot: false }, text: 'hello' }, ...over });

let store; let handleUpdate; let logger;
const build = (over = {}) => createTelegramWebhookHandler({ webhookSecret: SECRET, store, handleUpdate, logger, ...over });
const post = async (handler, payload = body(), headers = { 'x-telegram-bot-api-secret-token': SECRET }, method = 'POST') => {
  const res = makeRes();
  await handler(makeReq({ method, body: payload, headers: { authorization: undefined, ...headers } }), res);
  return res;
};

beforeEach(() => {
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  store = { claimUpdate: vi.fn(async () => true) };
  handleUpdate = vi.fn(async () => ({ action: 'captured' }));
});

describe('safeEqual', () => {
  it('compares secrets without caring about length or type tricks', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false); // an empty secret never matches
    for (const bad of [undefined, null, 5, ['abc'], {}]) expect(safeEqual(bad, 'abc')).toBe(false);
  });
});

describe('authentication', () => {
  it.each([
    ['no secret header', {}],
    ['a wrong secret', { 'x-telegram-bot-api-secret-token': 'nope' }],
    ['an almost-right secret', { 'x-telegram-bot-api-secret-token': `${SECRET}x` }],
    ['an empty secret', { 'x-telegram-bot-api-secret-token': '' }],
  ])('rejects %s with 401 and does nothing', async (_n, headers) => {
    const res = await post(build(), body(), headers);
    expect(res.statusCode).toBe(401);
    expect(store.claimUpdate).not.toHaveBeenCalled();
    expect(handleUpdate).not.toHaveBeenCalled();
    expect(res.body).not.toContain(SECRET);
  });

  it('refuses everything, with 503, when no secret is configured (it must never be open)', async () => {
    for (const secret of [undefined, '', null]) {
      const res = await post(build({ webhookSecret: secret }), body(), { 'x-telegram-bot-api-secret-token': '' });
      expect(res.statusCode).toBe(503);
    }
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('only accepts POST', async () => {
    const res = await post(build(), body(), { 'x-telegram-bot-api-secret-token': SECRET }, 'GET');
    expect(res.statusCode).toBe(405);
    expect(res.getHeader('allow')).toBe('POST');
  });

  it('checks the secret before reading the body', async () => {
    const parse = vi.fn();
    await post(build({ parse }), body(), {});
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('processing', () => {
  it('hands a new message to the conversation once, parsed, and says OK', async () => {
    const res = await post(build());
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(store.claimUpdate).toHaveBeenCalledWith('telegram', 500);
    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(handleUpdate.mock.calls[0][0]).toMatchObject({ updateId: 500, userId: '555', text: 'hello' });
  });

  it('answers a retry with OK without doing the work again', async () => {
    store.claimUpdate.mockResolvedValue(false);
    const res = await post(build());
    expect(res.statusCode).toBe(200);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('claims the update before doing anything else with it', async () => {
    const order = [];
    store.claimUpdate.mockImplementation(async () => { order.push('claim'); return true; });
    handleUpdate.mockImplementation(async () => { order.push('handle'); });
    await post(build());
    expect(order).toEqual(['claim', 'handle']);
  });

  it.each([
    ['an edited message', { update_id: 1, edited_message: body().message }],
    ['a group message', body({ message: { ...body().message, chat: { id: -1, type: 'group' } } })],
    ['a message from a bot', body({ message: { ...body().message, from: { id: 9, is_bot: true } } })],
    ['an empty message', body({ message: { message_id: 1, chat: { id: 5, type: 'private' }, from: { id: 5, is_bot: false } } })],
  ])('acknowledges %s but does nothing (so Telegram does not keep retrying)', async (_n, payload) => {
    const res = await post(build(), payload);
    expect(res.statusCode).toBe(200);
    expect(store.claimUpdate).not.toHaveBeenCalled();
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('rejects a body that is not an update at all', async () => {
    for (const bad of [null, 'text', [1], 42]) {
      const res = await post(build(), bad);
      expect(res.statusCode).toBe(400);
    }
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('asks Telegram to retry later (500) if it cannot record the update, rather than risk doing the work twice', async () => {
    store.claimUpdate.mockRejectedValue(new Error('connect ECONNREFUSED secret-host'));
    const res = await post(build());
    expect(res.statusCode).toBe(500);
    expect(handleUpdate).not.toHaveBeenCalled();
    expect(res.body).not.toContain('secret-host');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('hello');
  });

  it('still says OK if the conversation fails: it already told the person, and a retry would double the work', async () => {
    handleUpdate.mockRejectedValue(new Error('boom'));
    const res = await post(build());
    expect(res.statusCode).toBe(200);
    expect(logger.error).toHaveBeenCalled();
  });

  it('never echoes anything back and is not cacheable', async () => {
    const res = await post(build());
    expect(res.body).toBe('{"ok":true}');
    expect(res.getHeader('cache-control')).toBe('no-store');
  });
});
