/** Must match the receipts bucket in supabase/migrations/…_private_receipts_bucket.sql (a test enforces it). */
export const RECEIPT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
/** Value for <input accept>. */
export const RECEIPT_FILE_ACCEPT = RECEIPT_FILE_TYPES.join(',');

/**
 * Check a chosen file against what the private bucket will accept, so a rejected
 * upload is caught before the user fills in the form and not after saving.
 *
 * @param {{ type: string, size: number }} file
 * @returns {{ ok: true } | { ok: false, code: 'type' | 'size' }}
 */
export function validateReceiptFile(file) {
  if (!RECEIPT_FILE_TYPES.includes(file.type)) return { ok: false, code: 'type' };
  if (file.size > RECEIPT_FILE_MAX_BYTES) return { ok: false, code: 'size' };
  return { ok: true };
}
