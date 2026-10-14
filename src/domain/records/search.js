import { KIND_FIELDS, KIND_META } from './kinds.js';
import { summarizeRecord } from './schemas.js';

/**
 * Searching a list of records, and adding up what they cost.
 */

/** Capital letters and accents do not matter. */
const fold = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Everything a person can see in a record that is worth searching: its type, summary, date and values (choices by name). */
function searchableText(record, lang) {
  const fields = KIND_FIELDS[record.kind] ?? [];
  const values = Object.entries(record.payload ?? {}).flatMap(([key, value]) => {
    if (value === null || value === undefined || typeof value === 'object') return [];
    const field = fields.find((f) => f.key === key);
    const option = field?.options?.find((o) => o.value === value);
    return [String(value), ...(option ? [option[lang === 'es' ? 'es' : 'en']] : [])];
  });
  return fold([KIND_META[record.kind]?.label[lang === 'es' ? 'es' : 'en'] ?? '', summarizeRecord(record, lang), record.record_date ?? '', ...values].join(' \n '));
}

/**
 * Whether a record matches what was typed in a search box: every word must be found somewhere in it.
 * @param {object} record
 * @param {string | undefined} query
 * @param {'en' | 'es'} lang
 */
export function matchesSearch(record, query, lang) {
  const words = fold(query ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchableText(record, lang);
  return words.every((word) => text.includes(word));
}

const CENT = 100;

/**
 * The total of the `total_cost` of some records, and how many had a cost and how many did not.
 * Costs are added in cents so that 0.1 + 0.2 is 0.3.
 *
 * @param {object[]} records
 * @returns {{ total: number, counted: number, missing: number }}
 */
export function costSummary(records) {
  let cents = 0;
  let counted = 0;
  for (const record of records) {
    const cost = record.payload?.total_cost;
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) {
      cents += Math.round(cost * CENT);
      counted += 1;
    }
  }
  return { total: cents / CENT, counted, missing: records.length - counted };
}
