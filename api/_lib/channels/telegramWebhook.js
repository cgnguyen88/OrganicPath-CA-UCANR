import { createHash, timingSafeEqual } from 'node:crypto';
import { redact, sendJson } from '../httpUtils.js';
import { parseTelegramUpdate } from './telegramUpdate.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Constant-time comparison of two non-empty strings (hashed first so the lengths cannot leak). */
export function safeEqual(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || received === '' || expected === '') return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

/**
 * POST /api/agent/telegram — the endpoint Telegram calls with every message to the bot.
 *
 * Order matters: the shared secret is checked first (anyone can find this URL), then the update is
 * validated and recorded as handled, and only then is the conversation run. Telegram retries
 * anything that does not get a 200, so: ignorable updates and retries get a 200 and no work; a
 * failure to record the update gets a 500 (nothing was done, a retry is safe); and a failure in the
 * conversation still gets a 200, because the person was already told and a retry would repeat paid
 * work.
 *
 * @param {{
 *   webhookSecret: string | undefined,
 *   store: { claimUpdate: (provider: string, updateId: number) => Promise<boolean> },
 *   handleUpdate: (update: object) => Promise<unknown>,
 *   parse?: typeof parseTelegramUpdate,
 *   logger: { error: Function, warn: Function },
 * }} deps
 */
export function createTelegramWebhookHandler({ webhookSecret, store, handleUpdate, parse = parseTelegramUpdate, logger }) {
  return async function handleWebhook(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    if (!webhookSecret) {
      logger.error('[telegram] TELEGRAM_WEBHOOK_SECRET is not configured: refusing every request');
      sendJson(res, 503, { error: 'Not configured.' });
      return;
    }
    if (!safeEqual(req.headers[SECRET_HEADER], webhookSecret)) {
      sendJson(res, 401, { error: 'Unauthorized.' });
      return;
    }

    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: 'Invalid update.' });
      return;
    }

    const parsed = parse(body);
    if (!parsed.ok) {
      sendJson(res, 200, { ok: true }); // nothing to do; a non-200 would only make Telegram retry
      return;
    }
    const { update } = parsed;

    let isNew;
    try {
      isNew = await store.claimUpdate('telegram', update.updateId);
    } catch (err) {
      logger.error('[telegram] could not record an update', { reason: redact(err?.message ?? err) });
      sendJson(res, 500, { error: 'Try again.' });
      return;
    }
    if (!isNew) {
      sendJson(res, 200, { ok: true });
      return;
    }

    try {
      await handleUpdate(update);
    } catch (err) {
      logger.error('[telegram] conversation failed', { errorName: err?.name, reason: redact(err?.message ?? err) });
    }
    sendJson(res, 200, { ok: true });
  };
}
