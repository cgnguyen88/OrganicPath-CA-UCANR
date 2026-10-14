/**
 * Run the Telegram bot on your own computer, without a public URL.
 *
 *   npm run telegram:poll              # show what it would do
 *   npm run telegram:poll -- --yes     # start listening (Ctrl+C to stop)
 *
 * Telegram normally PUSHES each message to a public https webhook. This instead PULLS them (long
 * polling), so it works from localhost. Every message goes through the very same webhook handler the
 * deployed bot uses (secret check, once-only handling, linking, capture), so what you try here is what
 * production does. It only works while no webhook is registered; if one is, it refuses unless you pass
 * --replace-webhook (which switches the live bot off until you register the webhook again).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { createTelegramApi } from './telegramApi.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const POLL_WAIT_SECONDS = 25;
const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

class PollError extends Error {
  constructor(resumeOffset, cause) {
    super('polling stopped at a message');
    this.name = 'PollError';
    this.resumeOffset = resumeOffset;
    this.cause = cause;
  }
}

/** A minimal stand-in for the server response, enough for the webhook handler to write to. */
function fakeResponse() {
  const headers = {};
  return {
    statusCode: 200,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    getHeader(name) { return headers[name.toLowerCase()]; },
    end() { this.ended = true; },
    on() {},
  };
}

/**
 * Fetch one batch of messages and hand each to the webhook handler, as Telegram's own call would.
 * A message the handler could not take (5xx or a crash) stops the batch WITHOUT moving past it, so it
 * is tried again; one it refused for good (4xx) is skipped so it can never block the queue.
 *
 * @returns {Promise<{ offset: number, handled: number }>}
 * @throws {PollError} with `resumeOffset` set to the message to retry
 */
export async function pollOnce({ api, handler, secret, offset, timeoutSeconds }) {
  const updates = await api.getUpdates({ offset, timeoutSeconds });
  let next = offset;
  let handled = 0;
  for (const update of updates) {
    if (update === null || typeof update !== 'object' || !Number.isSafeInteger(update.update_id)) continue;
    const res = fakeResponse();
    try {
      await handler({ method: 'POST', headers: { [SECRET_HEADER]: secret }, body: update }, res);
    } catch (err) {
      throw new PollError(Math.max(next, update.update_id), err);
    }
    if (res.statusCode >= 500) throw new PollError(Math.max(next, update.update_id), new Error(`handler answered ${res.statusCode}`));
    next = Math.max(next, update.update_id + 1);
    handled += 1;
  }
  return { offset: next, handled };
}

/** Decide whether polling may start. Polling cuts off a registered webhook, so that needs an explicit yes. */
export function planPolling({ env, webhook, flags }) {
  for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[name]) return { ok: false, error: `${name} is not set (see docs/TELEGRAM_SETUP.md).` };
  }
  if (webhook?.url) {
    if (!flags?.replaceWebhook) {
      return { ok: false, error: `A webhook is already registered (${webhook.url}), so the live bot would stop working while you poll. Add --replace-webhook if that is what you want; register the webhook again afterwards.` };
    }
    return { ok: true, removeWebhook: true };
  }
  return { ok: true, removeWebhook: false };
}

/** Poll until `signal` aborts, backing off (1s, 2s, ... up to 30s) after errors and carrying the offset forward. */
export async function runPoller({ api, handler, secret, logger, signal, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let offset = 0;
  let backoff = FIRST_BACKOFF_MS;
  while (!signal.aborted) {
    try {
      const out = await pollOnce({ api, handler, secret, offset, timeoutSeconds: POLL_WAIT_SECONDS });
      offset = out.offset;
      backoff = FIRST_BACKOFF_MS;
      if (out.handled > 0) logger.info(`[poll] handled ${out.handled} message${out.handled === 1 ? '' : 's'}`);
    } catch (err) {
      if (signal.aborted) break;
      if (err instanceof PollError) offset = Math.max(offset, err.resumeOffset);
      // No error text: it can carry connection details. The name and code are enough to investigate.
      logger.warn('[poll] a batch failed; retrying', { errorName: (err.cause ?? err)?.name, code: (err.cause ?? err)?.code });
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  dotenv.config({ path: join(root, '.env.local'), quiet: true });
  const args = process.argv.slice(2);
  const flags = { yes: args.includes('--yes'), replaceWebhook: args.includes('--replace-webhook') };

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is not set (see docs/TELEGRAM_SETUP.md).');
    process.exit(1);
  }
  const api = createTelegramApi({ token: process.env.TELEGRAM_BOT_TOKEN });
  const bot = await api.getMe();
  const plan = planPolling({ env: process.env, webhook: await api.getWebhookInfo(), flags });
  if (!plan.ok) {
    console.error(plan.error);
    process.exit(1);
  }
  console.info(`This will run @${bot.username} on this computer by asking Telegram for new messages.${plan.removeWebhook ? ' It will REMOVE the registered webhook first.' : ''}`);
  if (!flags.yes) {
    console.info('Dry run: nothing started. Add --yes to begin.');
    return;
  }
  if (plan.removeWebhook) await api.deleteWebhook();

  const { createAgentHandlers } = await import('../agent/createAgentHandlers.js');
  const handler = createAgentHandlers(process.env, console).telegram;
  const controller = new AbortController();
  process.on('SIGINT', () => { console.info('\nStopping…'); controller.abort(); });
  console.info(`Listening as @${bot.username}. Open Telegram and send it a message. Press Ctrl+C to stop.`);
  await runPoller({ api, handler, secret: process.env.TELEGRAM_WEBHOOK_SECRET, logger: console, signal: controller.signal });
  console.info('Stopped.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
