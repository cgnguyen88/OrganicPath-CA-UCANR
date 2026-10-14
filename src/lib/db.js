import { supabase } from './supabase.js';

// ─── Profile ───────────────────────────────────────────────────────────────

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') console.error('getProfile:', error);
  return data || null;
}

export async function upsertProfile(userId, patch) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) console.error('upsertProfile:', error);
}

// ─── Files attached to records ──────────────────────────────────────────────

/** Attached files are private; viewers get a link that expires after this long. */
export const RECEIPT_URL_TTL_SECONDS = 300;
export const RECORD_URL_TTL_SECONDS = 300;

/** The two private buckets a record's attached files can be in, and how long a link to each lasts. */
const ATTACHMENT_BUCKETS = ['record-files', 'receipts'];
const ATTACHMENT_URL_TTL = { 'record-files': RECORD_URL_TTL_SECONDS, receipts: RECEIPT_URL_TTL_SECONDS };

/**
 * A short-lived link to a file attached to a record, wherever it is kept: photos the assistant read are in
 * `record-files`, and the photos of receipts from the old Receipt Manager are in `receipts`. An attachment
 * may name its bucket; one that does not is looked for in `record-files` and then `receipts`. Only those two
 * buckets are ever used, whatever an attachment says, and storage policies still decide who may open a file.
 *
 * @param {{ path?: string, bucket?: string } | null | undefined} file
 * @returns {Promise<string | null>} the link, or null when there is no such file or it may not be opened
 */
export async function getAttachmentUrl(file) {
  const path = file?.path;
  if (typeof path !== 'string' || path === '') return null;
  const buckets = ATTACHMENT_BUCKETS.includes(file.bucket) ? [file.bucket] : ATTACHMENT_BUCKETS;
  for (const bucket of buckets) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, ATTACHMENT_URL_TTL[bucket]);
    if (data?.signedUrl) return data.signedUrl;
  }
  console.error('getAttachmentUrl: no file could be opened for', path);
  return null;
}

// ─── Farm ───────────────────────────────────────────────────────────────────

/**
 * Make sure the signed-in user belongs to a farm (creates one if sign-up
 * provisioning missed it). Idempotent. Returns the farm id, or null on failure.
 */
export async function ensureMyFarm() {
  const { data, error } = await supabase.rpc('ensure_my_farm');
  if (error) {
    console.error('ensureMyFarm:', error);
    return null;
  }
  return data ?? null;
}

/** Farm details the caller is allowed to see (RLS), or null. */
export async function getFarm(farmId) {
  if (!farmId) return null;
  const { data, error } = await supabase
    .from('farms')
    .select('id, name, farm_code, season_start_month, season_start_day')
    .eq('id', farmId)
    .maybeSingle();
  if (error) {
    console.error('getFarm:', error);
    return null;
  }
  return data ?? null;
}

// ─── Debounced profile sync helper ─────────────────────────────────────────

const syncTimers = {};

/**
 * Debounced upsert — waits 800ms after last call before writing to Supabase.
 * @param {string} userId
 * @param {string} field  — column name in profiles table
 * @param {any} value
 */
export function debouncedSync(userId, field, value) {
  if (!userId) return;
  const key = `${userId}:${field}`;
  clearTimeout(syncTimers[key]);
  syncTimers[key] = setTimeout(() => {
    upsertProfile(userId, { [field]: value });
  }, 800);
}
