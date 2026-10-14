import { supabase } from './supabase.js';

/** Postgres insufficient_privilege: what row-level security raises on a rejected insert. */
const RLS_VIOLATION_CODE = '42501';

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

// ─── Receipts ──────────────────────────────────────────────────────────────

export async function getReceipts(userId) {
  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });
  if (error) console.error('getReceipts:', error);
  return data || [];
}

export async function addReceipt(userId, receipt) {
  const { id: _localId, addedAt: _addedAt, ...rest } = receipt;
  const row = {
    user_id: userId,
    date: rest.date || null,
    supplier: rest.supplier,
    product: rest.product,
    category: rest.category || null,
    omri_listed: rest.omriListed || null,
    quantity: rest.quantity || null,
    unit: rest.unit || null,
    total_cost: rest.totalCost ? parseFloat(rest.totalCost) : null,
    invoice_number: rest.invoiceNumber || null,
    notes: rest.notes || null,
    file_name: rest.fileName || null,
    file_path: rest.filePath || null,
    file_url: rest.fileUrl || null, // legacy rows only; new uploads store file_path
  };
  const insert = () => supabase.from('receipts').insert(row).select().single();

  let { data, error } = await insert();

  // Row-level security rejected the insert: the account may have no farm yet
  // (sign-up provisioning missed). Repair it and retry exactly once.
  if (error?.code === RLS_VIOLATION_CODE && (await ensureMyFarm())) {
    ({ data, error } = await insert());
  }

  if (error) console.error('addReceipt:', error);
  return data ?? null;
}

/**
 * Delete a receipt. Resolves true only if a row was actually removed: row-level
 * security reports a forbidden delete (e.g. crew) as zero rows, not as an error.
 */
export async function deleteReceipt(id) {
  const { data, error } = await supabase.from('receipts').delete().eq('id', id).select('id');
  if (error) {
    console.error('deleteReceipt:', error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// ─── File Upload ────────────────────────────────────────────────────────────

/** Receipt files are private; viewers get a link that expires after this long. */
export const RECEIPT_URL_TTL_SECONDS = 300;
export const RECORD_URL_TTL_SECONDS = 300;

const MAX_EXTENSION_LENGTH = 8;

/** Keep only [a-z0-9] from the part after the last dot, so a filename can never alter the storage path. */
function safeExtension(fileName) {
  const dot = fileName.lastIndexOf('.');
  const raw = dot === -1 ? '' : fileName.slice(dot + 1);
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_EXTENSION_LENGTH) || 'bin';
}

/**
 * Upload a receipt file to the private `receipts` bucket under the user's own
 * folder. Returns only the storage path: no URL is created or stored here.
 * Use getReceiptFileUrl(path) when someone needs to view the file.
 */
export async function uploadReceiptFile(userId, file) {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExtension(file.name)}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) {
    console.error('uploadReceiptFile:', error);
    return null;
  }
  return { path };
}

/** Short-lived signed URL for a stored receipt file, or null if it cannot be minted. */
export async function getReceiptFileUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, RECEIPT_URL_TTL_SECONDS);
  if (error) {
    console.error('getReceiptFileUrl:', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Short-lived signed URL for a record's source file (a photo or PDF the agent read), or null if
 * it cannot be minted. Storage policies only let a farm's members sign their own farm's files.
 */
export async function getRecordFileUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('record-files').createSignedUrl(path, RECORD_URL_TTL_SECONDS);
  if (error) {
    console.error('getRecordFileUrl:', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Remove an uploaded file (e.g. one left behind when saving its receipt failed). */
export async function deleteReceiptFile(path) {
  if (!path) return false;
  const { error } = await supabase.storage.from('receipts').remove([path]);
  if (error) {
    console.error('deleteReceiptFile:', error);
    return false;
  }
  return true;
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
