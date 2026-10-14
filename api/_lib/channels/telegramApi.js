/**
 * A thin client for the parts of the Telegram Bot API this app uses. The bot token is part of every
 * request URL, so nothing here ever puts a URL, the token, or a raw fetch error into an error
 * message: failures surface as TelegramApiError with only Telegram's own description.
 */

const API_ORIGIN = 'https://api.telegram.org';
const TOKEN_SHAPE = /^\d+:[A-Za-z0-9_-]{8,}$/;
const CHAT_ID = /^-?\d{1,20}$/;
const SECRET_SHAPE = /^[A-Za-z0-9_-]{1,256}$/;
const FILE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const MAX_MESSAGE_CHARS = 4096;
const DEFAULT_TIMEOUT_MS = 15_000;

export class TelegramApiError extends Error {
  /** @param {string} method @param {number | string} code @param {string} description @param {{ retryAfter?: number }} [extra] */
  constructor(method, code, description, extra = {}) {
    super(`Telegram ${method} failed: ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.code = code;
    this.description = description;
    this.retryAfter = extra.retryAfter;
  }
}

/**
 * @param {{ token: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export function createTelegramApi({ token, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) throw new Error('A valid Telegram bot token is required.');

  const scrub = (text) => String(text ?? '').split(token).join('[token]').slice(0, 300);

  async function request(method, url, init, waitMs = 0) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs + waitMs) });
    } catch {
      // The underlying error names the URL, which contains the token: say only that it failed.
      throw new TelegramApiError(method, 'network', 'could not reach Telegram');
    }
  }

  async function call(method, body, { waitMs } = {}) {
    const response = await request(method, `${API_ORIGIN}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, waitMs);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok || data?.ok !== true) {
      throw new TelegramApiError(method, data?.error_code ?? response.status, scrub(data?.description ?? 'unexpected response'), { retryAfter: data?.parameters?.retry_after });
    }
    return data.result;
  }

  return {
    /** Send plain text. No markup is ever enabled, so text from a photo or a farmer cannot format or link. */
    async sendMessage({ chatId, text, replyToMessageId }) {
      if (!CHAT_ID.test(String(chatId))) throw new Error('Invalid chat id.');
      const result = await call('sendMessage', {
        chat_id: String(chatId),
        text: String(text).slice(0, MAX_MESSAGE_CHARS),
        link_preview_options: { is_disabled: true },
        ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } } : {}),
      });
      return { messageId: result.message_id };
    },

    /** Show "typing…" while we work. Purely cosmetic, so a failure is ignored. */
    async sendChatAction({ chatId }) {
      if (!CHAT_ID.test(String(chatId))) throw new Error('Invalid chat id.');
      try {
        await call('sendChatAction', { chat_id: String(chatId), action: 'typing' });
      } catch {
        // not worth failing a message over
      }
    },

    /** Download a file a user sent. @returns {Promise<Buffer>} */
    async downloadFile(fileId, { maxBytes }) {
      const info = await call('getFile', { file_id: fileId });
      const path = typeof info?.file_path === 'string' ? info.file_path : '';
      if (path === '' || !path.split('/').every((segment) => FILE_SEGMENT.test(segment))) {
        throw new TelegramApiError('getFile', 'bad_path', 'unexpected file path');
      }
      if (Number.isFinite(info.file_size) && info.file_size > maxBytes) throw new TelegramApiError('getFile', 'too_large', 'file is too large');

      const response = await request('downloadFile', `${API_ORIGIN}/file/bot${token}/${path}`, { method: 'GET' });
      if (!response.ok) throw new TelegramApiError('downloadFile', response.status, 'download failed');
      if (Number(response.headers.get('content-length')) > maxBytes) throw new TelegramApiError('downloadFile', 'too_large', 'file is too large');
      // Read in pieces and stop the moment the limit is passed, whatever the server claimed.
      const chunks = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > maxBytes) {
          await response.body.cancel().catch(() => {});
          throw new TelegramApiError('downloadFile', 'too_large', 'file is too large');
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    /** Point Telegram at our webhook. Telegram will send `secretToken` back in a header on every call. */
    async setWebhook({ url, secretToken }) {
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('The webhook URL must be https.');
      if (typeof secretToken !== 'string' || !SECRET_SHAPE.test(secretToken)) throw new Error('The webhook secret must be 1 to 256 characters of A-Z, a-z, 0-9, _ or -.');
      await call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message'], drop_pending_updates: false });
    },

    /**
     * New messages after `offset`, waiting up to `timeoutSeconds` for one to arrive (long polling). For
     * local testing without a public URL; it only works while no webhook is registered.
     */
    async getUpdates({ offset, timeoutSeconds }) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 50) {
        throw new Error('Invalid polling arguments.');
      }
      return call('getUpdates', { offset, timeout: timeoutSeconds, allowed_updates: ['message'] }, { waitMs: timeoutSeconds * 1000 });
    },

    /** Which webhook (if any) Telegram currently delivers to. The URL is public; the secret is never returned. */
    async getWebhookInfo() {
      const info = await call('getWebhookInfo', {});
      return { url: info.url ?? '', pendingUpdates: info.pending_update_count ?? 0 };
    },

    /** Stop webhook delivery (messages already waiting are kept). Needed before polling. */
    async deleteWebhook() {
      await call('deleteWebhook', { drop_pending_updates: false });
    },

    async getMe() {
      const me = await call('getMe', {});
      return { username: me.username };
    },
  };
}
