import { describe, it, expect, vi } from 'vitest';
import { createTelegramApi, TelegramApiError } from './telegramApi.js';

const TOKEN = '123456:SECRET-token_abc';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bytes = (data, headers = {}) => new Response(data, { status: 200, headers });

function setup(...responses) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => { const next = queue.shift(); if (next instanceof Error) throw next; return next ?? json({ ok: true, result: {} }); });
  return { api: createTelegramApi({ token: TOKEN, fetchImpl }), fetchImpl };
}
const lastBody = (fetchImpl, i = 0) => JSON.parse(fetchImpl.mock.calls[i][1].body);

describe('createTelegramApi', () => {
  it('refuses to be built without a plausible bot token', () => {
    for (const bad of [undefined, '', 'nope', 'abc:def ghi']) expect(() => createTelegramApi({ token: bad })).toThrow(/token/i);
  });
});

describe('sendMessage', () => {
  it('posts plain text to the chat and returns the new message id', async () => {
    const { api, fetchImpl } = setup(json({ ok: true, result: { message_id: 88 } }));
    expect(await api.sendMessage({ chatId: '555', text: 'Hello' })).toEqual({ messageId: 88 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = lastBody(fetchImpl);
    expect(body).toMatchObject({ chat_id: '555', text: 'Hello', link_preview_options: { is_disabled: true } });
    expect(body).not.toHaveProperty('parse_mode'); // never markup: farm text cannot inject formatting or links
  });

  it('replies to a specific message when asked', async () => {
    const { api, fetchImpl } = setup(json({ ok: true, result: { message_id: 1 } }));
    await api.sendMessage({ chatId: '5', text: 'x', replyToMessageId: 42 });
    expect(lastBody(fetchImpl).reply_parameters).toEqual({ message_id: 42, allow_sending_without_reply: true });
  });

  it('cuts text to Telegram’s message limit', async () => {
    const { api, fetchImpl } = setup(json({ ok: true, result: { message_id: 1 } }));
    await api.sendMessage({ chatId: '5', text: 'x'.repeat(9000) });
    expect(lastBody(fetchImpl).text.length).toBeLessThanOrEqual(4096);
  });

  it('reports Telegram’s own explanation without ever including the token', async () => {
    const { api } = setup(json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403));
    const err = await api.sendMessage({ chatId: '5', text: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect(err).toMatchObject({ method: 'sendMessage', code: 403 });
    expect(err.message).toMatch(/blocked by the user/);
    expect(JSON.stringify(err) + err.message + err.stack).not.toContain('SECRET-token');
  });

  it('removes the token even if Telegram’s own description echoes it', async () => {
    const { api } = setup(json({ ok: false, error_code: 401, description: `Unauthorized: bot${TOKEN} is not valid` }, 401));
    const err = await api.sendMessage({ chatId: '5', text: 'x' }).catch((e) => e);
    expect(err.message + err.description).not.toContain('SECRET-token');
    expect(err.message).toMatch(/\[token\]/);
  });

  it('turns a network failure into an error that does not carry the request URL', async () => {
    const failure = Object.assign(new TypeError('fetch failed'), { cause: { message: `connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendMessage` } });
    const { api } = setup(failure);
    const err = await api.sendMessage({ chatId: '5', text: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect(err.method).toBe('sendMessage');
    expect(JSON.stringify(err) + err.message + err.stack + String(err.cause ?? '')).not.toContain('SECRET-token');
  });

  it('rejects an invalid chat id before calling Telegram', async () => {
    const { api, fetchImpl } = setup();
    await expect(api.sendMessage({ chatId: 'abc/../x', text: 'x' })).rejects.toThrow(/chat/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('sendChatAction', () => {
  it('shows "typing…" in the chat, and does not throw if Telegram refuses', async () => {
    const { api, fetchImpl } = setup(json({ ok: true, result: true }), json({ ok: false, error_code: 403, description: 'Forbidden' }, 403));
    await api.sendChatAction({ chatId: '555' });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/sendChatAction`);
    expect(lastBody(fetchImpl)).toEqual({ chat_id: '555', action: 'typing' });
    await expect(api.sendChatAction({ chatId: '555' })).resolves.toBeUndefined();
  });
});

describe('downloadFile', () => {
  const found = (path = 'photos/file_1.jpg', size = 1000) => json({ ok: true, result: { file_id: 'f', file_path: path, file_size: size } });

  it('looks the file up, then downloads exactly that path', async () => {
    const { api, fetchImpl } = setup(found(), bytes(Buffer.from('JPEGDATA')));
    const out = await api.downloadFile('file-id', { maxBytes: 5000 });
    expect(out.equals(Buffer.from('JPEGDATA'))).toBe(true);
    expect(lastBody(fetchImpl, 0)).toEqual({ file_id: 'file-id' });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/getFile`);
    expect(fetchImpl.mock.calls[1][0]).toBe(`https://api.telegram.org/file/bot${TOKEN}/photos/file_1.jpg`);
  });

  it.each([['../../etc/passwd'], ['/absolute/path'], ['photos/../../x'], ['photos/file 1.jpg'], ['photos/f?x=1'], ['photos/%2e%2e/x'], ['']])('refuses a file path Telegram should never send: %j', async (path) => {
    const { api, fetchImpl } = setup(found(path));
    await expect(api.downloadFile('f', { maxBytes: 5000 })).rejects.toBeInstanceOf(TelegramApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never fetched
  });

  it('refuses a file larger than allowed, from the size Telegram reports', async () => {
    const { api, fetchImpl } = setup(found('photos/a.jpg', 9000));
    await expect(api.downloadFile('f', { maxBytes: 5000 })).rejects.toMatchObject({ code: 'too_large' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a download that turns out larger than allowed, whatever it claimed', async () => {
    const { api } = setup(found('photos/a.jpg', 10), bytes(Buffer.alloc(6000)));
    await expect(api.downloadFile('f', { maxBytes: 5000 })).rejects.toMatchObject({ code: 'too_large' });
    const declared = setup(found('photos/a.jpg', 10), bytes(Buffer.alloc(10), { 'Content-Length': '999999' }));
    await expect(declared.api.downloadFile('f', { maxBytes: 5000 })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('stops reading as soon as the limit is passed, instead of buffering the whole body', async () => {
    let pulled = 0;
    const stream = new ReadableStream({ pull(controller) { pulled += 1; if (pulled > 50) controller.close(); else controller.enqueue(new Uint8Array(1000)); } });
    const { api } = setup(found('photos/a.jpg', 10), new Response(stream, { status: 200 }));
    await expect(api.downloadFile('f', { maxBytes: 2500 })).rejects.toMatchObject({ code: 'too_large' });
    expect(pulled).toBeLessThan(10);
  });

  it('reports a failed lookup or download without the token', async () => {
    const { api } = setup(json({ ok: false, error_code: 400, description: 'Bad Request: wrong file_id' }, 400));
    const err = await api.downloadFile('f', { maxBytes: 5000 }).catch((e) => e);
    expect(err).toBeInstanceOf(TelegramApiError);
    const dead = setup(found(), new Response('nope', { status: 404 }));
    const err2 = await dead.api.downloadFile('f', { maxBytes: 5000 }).catch((e) => e);
    expect(err2).toBeInstanceOf(TelegramApiError);
    expect(JSON.stringify(err2) + err2.message + err2.stack).not.toContain('SECRET-token');
  });
});

describe('getUpdates, getWebhookInfo and deleteWebhook (local testing without a public URL)', () => {
  it('asks Telegram for new messages after an offset, waiting for them for a while (long polling)', async () => {
    const { api, fetchImpl } = setup(json({ ok: true, result: [{ update_id: 7 }, { update_id: 8 }] }));
    expect(await api.getUpdates({ offset: 7, timeoutSeconds: 20 })).toEqual([{ update_id: 7 }, { update_id: 8 }]);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(lastBody(fetchImpl)).toEqual({ offset: 7, timeout: 20, allowed_updates: ['message'] });
  });

  it('allows the request to outlast the polling wait (a normal call gives up much sooner)', async () => {
    let signal;
    const fetchImpl = vi.fn(async (_url, init) => { signal = init.signal; return json({ ok: true, result: [] }); });
    await createTelegramApi({ token: TOKEN, fetchImpl }).getUpdates({ offset: 0, timeoutSeconds: 30 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it('returns an empty list when nothing is waiting, and refuses odd inputs', async () => {
    const { api } = setup(json({ ok: true, result: [] }));
    expect(await api.getUpdates({ offset: 0, timeoutSeconds: 1 })).toEqual([]);
    for (const bad of [{ offset: -1, timeoutSeconds: 1 }, { offset: 'x', timeoutSeconds: 1 }, { offset: 0, timeoutSeconds: 500 }, { offset: 0, timeoutSeconds: -1 }]) {
      await expect(api.getUpdates(bad)).rejects.toThrow();
    }
  });

  it('reports which webhook is registered, if any, without exposing the secret', async () => {
    const { api } = setup(json({ ok: true, result: { url: 'https://farm.example.com/api/agent/telegram', has_custom_certificate: false, pending_update_count: 2 } }));
    expect(await api.getWebhookInfo()).toEqual({ url: 'https://farm.example.com/api/agent/telegram', pendingUpdates: 2 });
    const none = setup(json({ ok: true, result: { url: '', pending_update_count: 0 } }));
    expect(await none.api.getWebhookInfo()).toEqual({ url: '', pendingUpdates: 0 });
  });

  it('removes the webhook, keeping messages that are waiting', async () => {
    const { api, fetchImpl } = setup(json({ ok: true, result: true }));
    await api.deleteWebhook();
    expect(lastBody(fetchImpl)).toEqual({ drop_pending_updates: false });
  });
});

describe('setWebhook and getMe', () => {
  it('registers an https URL with the secret token and only the updates we handle', async () => {
    const { api, fetchImpl } = setup(json({ ok: true, result: true }));
    await api.setWebhook({ url: 'https://app.example.com/api/agent/telegram', secretToken: 'abc_DEF-123' });
    expect(lastBody(fetchImpl)).toEqual({ url: 'https://app.example.com/api/agent/telegram', secret_token: 'abc_DEF-123', allowed_updates: ['message'], drop_pending_updates: false });
  });

  it.each([
    ['an http URL', { url: 'http://app.example.com/x', secretToken: 'abc' }],
    ['a secret with spaces', { url: 'https://a.example.com/x', secretToken: 'has space' }],
    ['an empty secret', { url: 'https://a.example.com/x', secretToken: '' }],
    ['a too-long secret', { url: 'https://a.example.com/x', secretToken: 'a'.repeat(257) }],
  ])('refuses %s', async (_n, args) => {
    const { api, fetchImpl } = setup();
    await expect(api.setWebhook(args)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads the bot’s username', async () => {
    const { api } = setup(json({ ok: true, result: { id: 1, is_bot: true, username: 'MyFarmBot' } }));
    expect(await api.getMe()).toEqual({ username: 'MyFarmBot' });
  });
});
