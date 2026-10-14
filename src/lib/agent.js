import { authedFetch } from './apiClient.js';

/** Mirrors the server's agent limits; the server enforces them again. */
export const CAPTURE_MAX_FILES = 3;
/**
 * Vercel rejects request bodies over ~4.5 MB and base64 adds a third, so keep what we send well
 * under that. Photos are downscaled first; a phone camera shot is far bigger than this.
 */
export const CAPTURE_MAX_TOTAL_BYTES = 3_000_000;
export const CAPTURE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const CAPTURE_FILE_TYPES = [...CAPTURE_IMAGE_TYPES, 'application/pdf'];
/** Value for <input accept>. */
export const CAPTURE_FILE_ACCEPT = CAPTURE_FILE_TYPES.join(',');

const MAX_IMAGE_EDGE_PX = 1600;
const KEEP_AS_IS_BYTES = 800_000;
const JPEG_QUALITY = 0.85;

/**
 * Shrink a photo before upload. Best effort: if the browser cannot decode or draw it, the
 * original is returned and the size check decides.
 * @param {File} file
 * @returns {Promise<Blob | File>}
 */
export async function downscaleImage(file) {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= KEEP_AS_IS_BYTES) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** @param {Blob} blob @returns {Promise<string>} base64 without the data: prefix */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Validate, shrink and encode chosen files for /api/agent/capture.
 *
 * @param {Array<File>} files
 * @param {{ downscale?: typeof downscaleImage, encode?: typeof blobToBase64 }} [deps]
 * @returns {Promise<{ ok: true, attachments: object[] } | { ok: false, code: 'count' | 'type' | 'size' | 'read' }>}
 */
export async function prepareAttachments(files, { downscale = downscaleImage, encode = blobToBase64 } = {}) {
  if (files.length > CAPTURE_MAX_FILES) return { ok: false, code: 'count' };
  if (files.some((f) => !CAPTURE_FILE_TYPES.includes(f.type))) return { ok: false, code: 'type' };

  try {
    const prepared = [];
    for (const file of files) {
      const blob = CAPTURE_IMAGE_TYPES.includes(file.type) ? await downscale(file) : file;
      prepared.push({ blob, mediaType: blob.type || file.type });
    }
    if (prepared.reduce((sum, p) => sum + p.blob.size, 0) > CAPTURE_MAX_TOTAL_BYTES) return { ok: false, code: 'size' };

    const attachments = [];
    for (const { blob, mediaType } of prepared) {
      const data = await encode(blob);
      attachments.push({ type: mediaType === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: mediaType, data } });
    }
    return { ok: true, attachments };
  } catch {
    return { ok: false, code: 'read' };
  }
}

const STATUS_CODES = {
  400: 'invalid', 401: 'signin', 403: 'no_farm', 413: 'too_large', 429: 'rate_limited',
};
const REPLY_STATUS_CODES = { ...STATUS_CODES, 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'invalid' };

const fail = (code) => ({ data: null, error: { code } });

/** POST JSON to one of our agent routes. Resolves to `{ data, error }`; never throws. */
async function postAgent(path, body, statusCodes) {
  let response;
  try {
    response = await authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    return fail(err?.code === 'not_signed_in' ? 'signin' : 'network');
  }
  if (!response.ok) return fail(statusCodes[response.status] ?? 'unavailable');
  try {
    return { data: await response.json(), error: null };
  } catch {
    return fail('unavailable');
  }
}

/**
 * Ask the assistant to read a message and/or photos and file the records for review.
 * @param {{ text: string, attachments: object[], lang: 'en' | 'es' }} input
 */
export const captureRecords = ({ text, attachments, lang }) => postAgent('/api/agent/capture', { text, attachments, lang }, STATUS_CODES);

/**
 * Answer the assistant's follow-up question about one record.
 * @param {{ recordId: string, text: string, lang: 'en' | 'es' }} input
 */
export const replyToRecord = ({ recordId, text, lang }) => postAgent('/api/agent/reply', { record_id: recordId, text, lang }, REPLY_STATUS_CODES);

/**
 * Ask whether a material is named in the U.S. organic regulations (7 CFR 205), with citations.
 * @param {{ material: string, use?: string, lang: 'en' | 'es' }} input
 */
export const checkMaterial = ({ material, use, lang }) => postAgent('/api/agent/check-material', { material, use, lang }, STATUS_CODES);
