import { supabase } from './supabase.js';

const BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/;
const LINK_CODE = /^[0-9a-f]{32}$/;

/** Map a database error to a code the UI can explain. */
function describeError(error) {
  switch (error?.code) {
    case '42501': return 'no_farm';
    case '54000': return 'rate_limited';
    case '28000': return 'signin';
    default: return 'unknown';
  }
}

/**
 * Ask for a one-time code to connect a Telegram account. Show it to the user right away: it is only
 * ever returned once, expires in minutes, and works for a single Telegram account.
 *
 * @param {'en' | 'es'} lang the language the bot should greet them in
 * @returns {Promise<{ data: { code: string, expiresAt: string }, error: null } | { data: null, error: { code: string } }>}
 */
export async function createTelegramLinkCode(lang) {
  const { data, error } = await supabase.rpc('create_channel_link_code', { p_lang: lang === 'es' ? 'es' : 'en' });
  if (error) return { data: null, error: { code: describeError(error) } };
  const row = data?.[0];
  if (!row?.code) return { data: null, error: { code: 'unknown' } };
  return { data: { code: row.code, expiresAt: row.expires_at }, error: null };
}

/**
 * The signed-in user's Telegram links, connected or still waiting for the Telegram user to confirm. The
 * Telegram account id itself is never fetched; the name Telegram showed at link time is, so the user can
 * recognise their own account (and notice one that is not).
 */
export async function listTelegramLinks() {
  const { data, error } = await supabase.from('channel_identities').select('id, lang, linked_at, confirmed_at, display_name').eq('provider', 'telegram').order('linked_at', { ascending: false });
  if (error) return { data: null, error: { code: 'unknown' } };
  return { data: data.map((row) => ({ id: row.id, lang: row.lang, linkedAt: row.linked_at, confirmed: Boolean(row.confirmed_at), displayName: row.display_name ?? null })), error: null };
}

export async function unlinkTelegram(identityId) {
  const { error } = await supabase.from('channel_identities').delete().eq('id', identityId);
  return { error: error ? { code: 'unknown' } : null };
}

// Read by name: referring to the whole build environment object makes Vite copy every VITE_ variable
// (including the Vercel build details) into the browser bundle.
const BUILD_SETTINGS = Object.freeze({ VITE_TELEGRAM_BOT_USERNAME: import.meta.env.VITE_TELEGRAM_BOT_USERNAME });

/** The bot's public username from the build environment, or null when it is missing or implausible. */
export function telegramBotUsername(env = BUILD_SETTINGS) {
  const raw = typeof env?.VITE_TELEGRAM_BOT_USERNAME === 'string' ? env.VITE_TELEGRAM_BOT_USERNAME.replace(/^@/, '') : '';
  return BOT_USERNAME.test(raw) ? raw : null;
}

/** The link that opens the bot and hands it the code, or null if either part looks wrong. */
export function telegramDeepLink(botUsername, code) {
  if (typeof botUsername !== 'string' || !BOT_USERNAME.test(botUsername) || typeof code !== 'string' || !LINK_CODE.test(code)) return null;
  return `https://t.me/${botUsername}?start=${code}`;
}
