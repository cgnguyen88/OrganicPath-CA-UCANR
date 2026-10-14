import { cleanText } from './csv.js';
import { KIND_FIELDS } from './kinds.js';
import { parseDecimalText } from './numbers.js';

/**
 * Fields: the named places a farm grows things. Records keep a field as text, and a farm's field list
 * gives each place one name to choose from. These are the rules for a field's name and size, and the
 * summaries of what happened in each field that the screens show.
 */

export const FIELD_NAME_MAX = 60;
const NOTES_MAX = 1000;
const AREA_MAX = 1_000_000;
const AREA_DECIMALS = 1000;
const AREA_UNITS = ['acre', 'hectare', 'sq_ft'];

/** The kinds of record that name a field (they have a `field` among their fields). */
export const FIELD_KINDS = Object.freeze(Object.entries(KIND_FIELDS).filter(([, fields]) => fields.some((f) => f.key === 'field')).map(([kind]) => kind));

/** Who may add, change, archive and delete fields (the database lets only these roles). @param {unknown} role */
export const canManageFields = (role) => role === 'owner' || role === 'manager';

/** Counted the way the database counts: by characters, not by the UTF-16 units JavaScript's `length` counts. */
const lengthOf = (text) => [...text].length;

/** Zero-width characters and left/right marks: invisible, so two names that differ only by them would look the same. */
const INVISIBLE = /[\u200B-\u200F\u2060]/g;

/** A field name as it is kept: on one line, single spaces, nothing at either end, no control characters. */
export const tidyFieldName = (value) => cleanText(value).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

/** What two spellings of a field have in common: capital letters and spacing do not matter. */
export const fieldKey = (value) => tidyFieldName(value).toLowerCase();

/** @returns {number | null | undefined} a number, null for blank, undefined for something that is not an area */
function parseArea(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const number = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseDecimalText(raw) : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || number > AREA_MAX) return undefined;
  return Math.round(number * AREA_DECIMALS) / AREA_DECIMALS;
}

/**
 * Check what was typed for a field and write it the way the database keeps it.
 *
 * @param {{ name?: unknown, area?: unknown, area_unit?: unknown, notes?: unknown } | undefined} input
 * @returns {{ ok: true, errors: {}, value: { name: string, area: number | null, area_unit: string | null, notes: string | null } }
 *   | { ok: false, errors: Record<string, string>, value: null }}
 */
export function validateFieldInput(input) {
  const { name: rawName, area: rawArea, area_unit: rawUnit, notes: rawNotes } = input ?? {};
  const errors = {};

  const name = tidyFieldName(rawName);
  if (name === '') errors.name = 'required';
  else if (lengthOf(name) > FIELD_NAME_MAX) errors.name = 'too_long';

  const area = parseArea(rawArea);
  let areaUnit = null;
  if (area === undefined) errors.area = 'invalid';
  else if (area !== null) {
    if (rawUnit === undefined || rawUnit === null || rawUnit === '') errors.area_unit = 'required';
    else if (!AREA_UNITS.includes(rawUnit)) errors.area_unit = 'invalid';
    else areaUnit = rawUnit;
  }

  const notes = cleanText(rawNotes).trim();
  if (lengthOf(notes) > NOTES_MAX) errors.notes = 'too_long';

  if (Object.keys(errors).length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: {}, value: { name, area: area ?? null, area_unit: areaUnit, notes: notes === '' ? null : notes } };
}

/** The field a record's text names, or null. @param {unknown} text @param {Array<{ name: string }>} fields */
export function findField(text, fields) {
  const key = fieldKey(text);
  return key === '' ? null : fields.find((f) => fieldKey(f.name) === key) ?? null;
}

const fieldTextOf = (record) => (typeof record.payload?.field === 'string' ? record.payload.field : '');
const isApplication = (record) => record.kind === 'amendment' || (record.kind === 'activity' && record.payload?.activity_type === 'spray');

/** By date, oldest first; a record with no date comes last. */
const oldestFirst = (a, b) => {
  if (a.record_date === b.record_date) return 0;
  if (!a.record_date) return 1;
  if (!b.record_date) return -1;
  return a.record_date < b.record_date ? -1 : 1;
};
/** By date, newest first; a record with no date comes last. */
const newestFirst = (a, b) => {
  if (a.record_date === b.record_date) return 0;
  if (!a.record_date) return 1;
  if (!b.record_date) return -1;
  return a.record_date < b.record_date ? 1 : -1;
};
const latest = (records) => records.map((r) => r.record_date).filter(Boolean).sort().at(-1) ?? null;

/**
 * What happened in each field: how many plantings, applications (amendments and sprays) and harvests, the
 * last of each, the crops, and the records themselves (newest first). Only approved records count.
 *
 * @param {Array<{ name: string }>} fields
 * @param {object[]} records
 */
export function summarizeFields(fields, records) {
  const byKey = new Map();
  for (const record of records) {
    if (record.status !== 'approved' || !FIELD_KINDS.includes(record.kind)) continue;
    const key = fieldKey(fieldTextOf(record));
    if (key === '') continue;
    const list = byKey.get(key);
    if (list) list.push(record);
    else byKey.set(key, [record]);
  }

  return fields.map((field) => {
    const mine = byKey.get(fieldKey(field.name)) ?? [];
    const inOrder = [...mine].sort(oldestFirst);
    const applications = mine.filter(isApplication);
    const harvests = mine.filter((r) => r.kind === 'harvest');
    const dates = mine.map((r) => r.record_date).filter(Boolean).sort();
    const crops = [...new Set(inOrder.filter((r) => r.kind === 'planting' || r.kind === 'harvest').map((r) => cleanText(r.payload?.crop).trim()).filter(Boolean))];
    return {
      field,
      uses: mine.length,
      plantings: mine.filter((r) => r.kind === 'planting').length,
      applications: applications.length,
      harvests: harvests.length,
      lastApplication: latest(applications),
      lastHarvest: latest(harvests),
      firstUsed: dates[0] ?? null,
      lastUsed: dates.at(-1) ?? null,
      crops,
      records: [...mine].sort(newestFirst),
    };
  });
}

/**
 * The field names that records use but the field list does not have, most used first, each spelled the way
 * the records spell it most often. Names that could not be a field name are left out.
 *
 * @param {object[]} records
 * @param {Array<{ name: string }>} fields
 * @returns {Array<{ name: string, uses: number }>}
 */
export function unregisteredFieldNames(records, fields) {
  const known = new Set(fields.map((f) => fieldKey(f.name)));
  const byKey = new Map();
  for (const record of records) {
    if (record.status !== 'approved' || !FIELD_KINDS.includes(record.kind)) continue;
    const name = tidyFieldName(fieldTextOf(record));
    const key = name.toLowerCase();
    if (name === '' || lengthOf(name) > FIELD_NAME_MAX || known.has(key)) continue;
    const entry = byKey.get(key) ?? { uses: 0, spellings: new Map() };
    entry.uses += 1;
    entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .map(({ uses, spellings }) => ({ name: [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], uses }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}
