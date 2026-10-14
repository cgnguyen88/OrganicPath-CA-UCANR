import { FIELD_NAME_MAX, fieldKey, tidyFieldName } from '../../../src/domain/records/fields.js';
import { redact } from '../httpUtils.js';

/** At most this many field names go to the model, so a huge list cannot swell every request. */
export const MAX_FIELD_NAMES = 100;
/** How long a capture waits for the farm's field list before going on without it. */
export const FIELD_READ_TIMEOUT_MS = 2000;

/**
 * The farm's field names, made safe to show the model: text only, on one line, tidy, 60 characters or fewer,
 * each place once (ignoring capital letters), and not too many. They come from the farm's own list, but a
 * name is typed by a person, so it is treated as data like everything else the model reads.
 *
 * @param {unknown} names
 * @returns {string[]}
 */
export function cleanFieldNames(names) {
  if (!Array.isArray(names)) return [];
  const seen = new Set();
  const clean = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = tidyFieldName(raw);
    const key = fieldKey(name);
    if (key === '' || [...name].length > FIELD_NAME_MAX || seen.has(key)) continue;
    seen.add(key);
    clean.push(name);
    if (clean.length === MAX_FIELD_NAMES) break;
  }
  return clean;
}

/**
 * The line that tells the model which fields the farm has: labelled as data, the names as a JSON list so a
 * name can never read as anything but one string. Empty (nothing to add) when the farm has no fields.
 *
 * @param {unknown} names
 */
export function fieldListLine(names) {
  const clean = cleanFieldNames(names);
  return clean.length === 0 ? '' : `Farm fields (data): ${JSON.stringify(clean)}`;
}

/**
 * Read the farm's field names for a model call. The list only helps the model spell a field the way the farm
 * does, so a failure to read it, or a read that takes more than a couple of seconds, must never fail or hold up
 * the capture: say so (without the details) and go on without. Stores read one name more than the model is
 * told, so a farm with too many fields is noticed (and logged, without any names).
 *
 * @param {(() => Promise<unknown>) | undefined} read
 * @param {{ warn: Function, info: Function }} logger
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string[]>}
 */
export async function readFieldNames(read, logger, { timeoutMs = FIELD_READ_TIMEOUT_MS } = {}) {
  if (!read) return [];
  let timer;
  try {
    const names = await Promise.race([
      read(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('reading the field list timed out')), timeoutMs);
      }),
    ]);
    if (Array.isArray(names) && names.length > MAX_FIELD_NAMES) logger.info('[agent] the farm has more fields than the agent is told about');
    return cleanFieldNames(names);
  } catch (err) {
    logger.warn('[agent] could not read the farm field list; going on without it', { reason: redact(err?.message ?? err) });
    return [];
  } finally {
    clearTimeout(timer);
  }
}
