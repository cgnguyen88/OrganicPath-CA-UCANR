import { z } from 'zod';
import { KIND_FIELDS, KIND_META, requiredFieldKeys, optionLabel } from './kinds.js';
import { parseDecimalText } from './numbers.js';

const MAX_TEXT = 200;
const MAX_TEXTAREA = 2000;
const MAX_NUMBER = 1e9;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
/** The first and last date a record, or a report, may use (for date pickers). */
export const DATE_MIN = `${MIN_YEAR}-01-01`;
export const DATE_MAX = `${MAX_YEAR}-12-31`;

const blankToUndefined = (value) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value;

function fieldSchema(field) {
  if (field.type === 'number') {
    const toNumber = (value) => {
      const v = blankToUndefined(value);
      if (typeof v !== 'string') return v;
      return parseDecimalText(v);
    };
    return z.preprocess(toNumber, z.number().finite().min(0).max(MAX_NUMBER).optional());
  }
  if (field.type === 'select') {
    return z.preprocess(blankToUndefined, z.enum(field.options.map((o) => o.value)).optional());
  }
  return z.preprocess(blankToUndefined, z.string().trim().max(field.type === 'textarea' ? MAX_TEXTAREA : MAX_TEXT).optional());
}

// Unknown keys are stripped: only the kind's own fields survive.
const PAYLOAD_SCHEMAS = Object.fromEntries(
  Object.entries(KIND_FIELDS).map(([kind, fields]) => [kind, z.object(Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f)])))]),
);

/** A real calendar date written YYYY-MM-DD, within a sensible range. */
export const isValidIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const withoutUndefined = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

/**
 * Validate and normalize a record and work out what is still missing.
 * `ok` means the data that IS present is well-formed (a draft can be ok but incomplete);
 * `complete` means it is ready for review: valid, dated, and every required field filled.
 *
 * @param {string} kind
 * @param {{ record_date?: unknown, payload?: Record<string, unknown> }} [input]
 * @returns {{
 *   ok: boolean, complete: boolean, errors: Record<string, string>,
 *   missing: string[], value: { record_date: string | null, payload: Record<string, unknown> } | null,
 * }}
 */
export function evaluateRecord(kind, input = {}) {
  const schema = PAYLOAD_SCHEMAS[kind];
  if (!schema) return { ok: false, complete: false, errors: { kind: 'unknown_kind' }, missing: [], value: null };

  const errors = {};
  const rawDate = blankToUndefined(input.record_date);
  if (rawDate !== undefined && !isValidIsoDate(rawDate)) errors.record_date = 'invalid';

  const parsed = schema.safeParse(input.payload ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? 'payload')] = 'invalid';
  }

  const payload = parsed.success
    ? withoutUndefined(parsed.data)
    : withoutUndefined(Object.fromEntries(KIND_FIELDS[kind].map((f) => [f.key, blankToUndefined(input.payload?.[f.key])])));

  const missing = [
    ...(rawDate === undefined ? ['record_date'] : []),
    ...requiredFieldKeys(kind, payload).filter((key) => payload[key] === undefined),
  ];

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    complete: ok && missing.length === 0,
    errors,
    missing,
    value: ok ? { record_date: rawDate ?? null, payload } : null,
  };
}

const FINGERPRINT_KEYS = Object.freeze({
  purchase: ['supplier', 'product', 'total_cost', 'invoice_number'],
  seed: ['crop', 'variety', 'lot_number', 'supplier'],
  planting: ['crop', 'field', 'variety'],
  amendment: ['material', 'field', 'rate', 'quantity'],
  harvest: ['crop', 'field', 'quantity', 'unit', 'lot_number'],
  input: ['product', 'manufacturer'],
  inventory: ['item', 'location', 'lot_number'],
  activity: ['activity_type', 'field', 'product'],
  note: ['text'],
});

const normalizePart = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return value.toFixed(2);
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * A stable identity for "probably the same record" (e.g. the same invoice photographed
 * twice). It is stored on each record so the app can warn about likely duplicates (the warning
 * itself is not built yet), never to forbid them: two genuine records can look alike.
 * Returns null when there is too little to go on.
 *
 * @param {string} kind
 * @param {string | null | undefined} recordDate
 * @param {Record<string, unknown>} payload
 * @returns {string | null}
 */
export function recordFingerprint(kind, recordDate, payload) {
  const parts = (FINGERPRINT_KEYS[kind] ?? []).map((key) => normalizePart(payload?.[key]));
  if (parts.every((part) => part === '')) return null;
  return `${kind}|${recordDate ?? ''}|${parts.join('|')}`;
}

const MAX_SUMMARY_TEXT = 60;

/**
 * A short, human-readable title for a record.
 * @param {{ kind: string, payload?: Record<string, unknown> }} record
 * @param {'en' | 'es'} lang
 * @returns {string}
 */
export function summarizeRecord(record, lang) {
  const p = record.payload ?? {};
  const qty = p.quantity !== undefined && p.quantity !== null ? `${p.quantity}${p.unit ? ` ${p.unit}` : ''}` : '';
  const parts = {
    purchase: [p.product, p.supplier],
    activity: [p.activity_type && optionLabel('activity', 'activity_type', p.activity_type, lang), p.field, p.product],
    harvest: [p.crop, qty],
    inventory: [p.item, qty],
    planting: [p.crop, p.field],
    amendment: [p.material, p.field],
    input: [p.product],
    note: [typeof p.text === 'string' && p.text.length > MAX_SUMMARY_TEXT ? `${p.text.slice(0, MAX_SUMMARY_TEXT)}…` : p.text],
  }[record.kind];

  if (record.kind === 'seed') {
    const seed = [p.crop, p.variety].filter(Boolean).join(' ');
    if (seed) return seed;
  } else if (parts) {
    const title = parts.filter(Boolean).join(' · ');
    if (title) return title;
  }
  return KIND_META[record.kind]?.label[lang === 'es' ? 'es' : 'en'] ?? record.kind;
}
