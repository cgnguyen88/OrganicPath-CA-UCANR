import { createChannelHandler } from './channelCore.js';
import { createChannelStore } from './channelStore.js';
import { createTelegramApi } from './telegramApi.js';
import { createTelegramWebhookHandler } from './telegramWebhook.js';

const ONE_HOUR_MS = 3_600_000;
const MIN_SECRET_CHARS = 32;
const STRANGER_REPLIES_PER_HOUR = 5;
const LINK_ATTEMPTS_PER_HOUR = 10;

/**
 * Wire the Telegram webhook from environment variables. If anything essential is missing the
 * returned handler refuses every request (503) and says why in the log, instead of half-working:
 * an open or broken webhook is worse than a closed one.
 *
 * @param {{
 *   env: Record<string, string | undefined>, config: object, anthropic: object | null,
 *   agentStore: object, limiters: ReturnType<typeof import('../limiters.js').createAgentLimiters>,
 *   logger: { error: Function, warn: Function, info: Function },
 *   overrides?: { telegram?: object, channelStore?: object, extract?: Function, reply?: Function, fetchImpl?: typeof fetch },
 * }} deps
 */
export function createTelegramHandler({ env, config, anthropic, agentStore, limiters, logger, overrides = {} }) {
  const refuse = (why) => {
    // Quiet when Telegram was never meant to be set up; loud when it was set up halfway.
    if (env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_WEBHOOK_SECRET) logger.warn(`[telegram] disabled: ${why}`);
    return createTelegramWebhookHandler({ webhookSecret: undefined, store: {}, handleUpdate: async () => {}, logger });
  };

  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return refuse('TELEGRAM_WEBHOOK_SECRET is not set');
  // The secret is what stops anyone who finds this URL from posting messages as a linked person.
  if (secret.length < MIN_SECRET_CHARS) return refuse(`TELEGRAM_WEBHOOK_SECRET is too short (use at least ${MIN_SECRET_CHARS} characters, for example: openssl rand -hex 24)`);
  if (!env.SUPABASE_SERVICE_ROLE_KEY && !overrides.channelStore) return refuse('SUPABASE_SERVICE_ROLE_KEY is not set (the bot needs it to find linked accounts)');

  let telegram = overrides.telegram;
  if (!telegram) {
    try {
      telegram = createTelegramApi({ token: env.TELEGRAM_BOT_TOKEN, fetchImpl: overrides.fetchImpl });
    } catch {
      return refuse('TELEGRAM_BOT_TOKEN is missing or malformed');
    }
  }

  const store = overrides.channelStore ?? createChannelStore(env, { agentStore });
  // Same buckets as the web form: a person's allowance is one thing, whichever way they send.
  const chat = limiters.forEndpoint('capture');
  const handleUpdate = createChannelHandler({
    config, store, telegram, getAnthropic: () => anthropic, logger,
    extract: overrides.extract, reply: overrides.reply,
    limiters: {
      chat: { ...chat, globalLimiter: limiters.global },
      stranger: limiters.single('telegram-stranger-hour', STRANGER_REPLIES_PER_HOUR, ONE_HOUR_MS),
      linking: limiters.single('telegram-link-hour', LINK_ATTEMPTS_PER_HOUR, ONE_HOUR_MS),
    },
  });
  return createTelegramWebhookHandler({ webhookSecret: secret, store, handleUpdate, logger });
}
