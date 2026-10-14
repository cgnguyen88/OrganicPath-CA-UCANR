/**
 * Register the bot's webhook with Telegram.
 *
 *   npm run telegram:webhook -- --url https://YOUR-APP/api/agent/telegram          # show the plan
 *   npm run telegram:webhook -- --url https://YOUR-APP/api/agent/telegram --yes    # do it
 *
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local or the environment. The secret
 * is sent to Telegram, which returns it in a header on every call so the app can tell Telegram's
 * requests from anyone else's. Make one with:  openssl rand -hex 24
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { createTelegramApi } from './telegramApi.js';

const WEBHOOK_PATH = '/api/agent/telegram';
const MIN_SECRET_CHARS = 32;

/** Check the inputs and describe what would happen. Never echoes a secret. */
export function planWebhook({ env, url }) {
  if (!url) return { ok: false, error: 'Pass the public URL with --url https://YOUR-APP/api/agent/telegram' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'That --url is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'Telegram only delivers to https URLs.' };
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) || parsed.hostname.endsWith('.local')) {
    return { ok: false, error: 'Telegram cannot reach localhost: use your public URL (a deployed app, or a tunnel).' };
  }
  if (parsed.pathname !== WEBHOOK_PATH) return { ok: false, error: `The URL path must be ${WEBHOOK_PATH}` };
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set.' };
  if (!env.TELEGRAM_WEBHOOK_SECRET) return { ok: false, error: 'TELEGRAM_WEBHOOK_SECRET is not set.' };
  if (env.TELEGRAM_WEBHOOK_SECRET.length < MIN_SECRET_CHARS) return { ok: false, error: `TELEGRAM_WEBHOOK_SECRET should be at least ${MIN_SECRET_CHARS} characters.` };
  return { ok: true, url: parsed.toString(), summary: `Telegram will deliver messages for this bot to ${parsed.toString()}` };
}

export async function applyWebhook({ api, url, secret }) {
  await api.setWebhook({ url, secretToken: secret });
  return api.getMe();
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  dotenv.config({ path: join(root, '.env.local'), quiet: true });

  const args = process.argv.slice(2);
  const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : undefined;
  const plan = planWebhook({ env: process.env, url });
  if (!plan.ok) {
    console.error(plan.error);
    process.exit(1);
  }
  console.info(plan.summary);
  if (!args.includes('--yes')) {
    console.info('Dry run: nothing changed. Add --yes to register it.');
    return;
  }
  try {
    const bot = await applyWebhook({ api: createTelegramApi({ token: process.env.TELEGRAM_BOT_TOKEN }), url: plan.url, secret: process.env.TELEGRAM_WEBHOOK_SECRET });
    console.info(`Done. The bot @${bot.username} now delivers to your app.`);
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
