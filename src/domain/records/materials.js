import { cleanText } from './csv.js';

/**
 * The materials a farm uses (fertilizers, amendments, sprays, seed treatments...), worked out from its
 * approved records. Every tool that needs "what is on this farm" reads this one list, so they cannot
 * disagree with the farm's records or with each other.
 */

/** The kinds of record that name a material. */
export const MATERIAL_KINDS = Object.freeze(['purchase', 'input', 'amendment', 'activity']);

const KNOWN_STATUSES = ['listed', 'not_listed', 'not_applicable'];
const MAX_PROMPT_VALUE = 100;

/** The material a record names, or '' when it names none (an irrigation activity, a purchase of equipment...). */
function nameOf(record) {
  const p = record.payload ?? {};
  switch (record.kind) {
    case 'purchase': return p.category === 'equipment' ? '' : p.product;
    case 'input': return p.product;
    case 'amendment': return p.material;
    case 'activity': return p.activity_type === 'spray' ? p.product : '';
    default: return '';
  }
}

const display = (value) => cleanText(value).replace(/\s+/g, ' ').trim();

/** Upper/lower case, accents, spacing and punctuation do not make a different material. */
export const materialKey = (name) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Newest first; a record with no date (an Input List entry) counts as the oldest. */
export function newestFirst(a, b) {
  if (a.record_date !== b.record_date) {
    if (!a.record_date) return 1;
    if (!b.record_date) return -1;
    return a.record_date < b.record_date ? 1 : -1;
  }
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
}

const firstWhere = (records, pick) => {
  for (const record of records) {
    const value = pick(record);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

function summarize(key, records) {
  const sorted = [...records].sort(newestFirst);
  const dates = sorted.map((r) => r.record_date).filter(Boolean);
  const purchaseDates = sorted.filter((r) => r.kind === 'purchase' && r.record_date).map((r) => r.record_date);

  const suppliers = [];
  const seen = new Set();
  for (const record of sorted) {
    const supplier = display(record.payload?.supplier);
    if (supplier && !seen.has(supplier.toLowerCase())) {
      seen.add(supplier.toLowerCase());
      suppliers.push(supplier);
    }
  }

  const known = sorted.map((r) => r.payload?.omri_status).filter((status) => KNOWN_STATUSES.includes(status));

  return {
    key,
    name: display(nameOf(sorted[0])),
    category: firstWhere(sorted, (r) => r.payload?.category),
    suppliers,
    omriStatus: known[0] ?? 'unknown',
    statusConflict: new Set(known).size > 1,
    omriListingNumber: firstWhere(sorted, (r) => display(r.payload?.omri_listing_number)),
    purchases: sorted.filter((r) => r.kind === 'purchase').length,
    applications: sorted.filter((r) => r.kind === 'amendment' || r.kind === 'activity').length,
    onInputList: sorted.some((r) => r.kind === 'input'),
    sources: [...new Set(sorted.map((r) => r.kind))].sort(),
    firstDate: dates.length ? dates[dates.length - 1] : null,
    lastDate: dates[0] ?? null,
    lastPurchased: purchaseDates[0] ?? null,
  };
}

/**
 * @param {object[]} records any records; only approved ones that name a material are used
 * @returns {Array<{
 *   key: string, name: string, category?: string, suppliers: string[], omriStatus: 'listed' | 'not_listed' | 'not_applicable' | 'unknown',
 *   statusConflict: boolean, omriListingNumber?: string, purchases: number, applications: number, onInputList: boolean,
 *   sources: string[], firstDate: string | null, lastDate: string | null, lastPurchased: string | null,
 * }>} one row per material, in name order
 */
export function summarizeMaterials(records) {
  const groups = new Map();
  for (const record of records) {
    if (record.status !== 'approved') continue; // (only the kinds that name a material give a name at all)
    const name = display(nameOf(record));
    const key = materialKey(name);
    if (key === '') continue;
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }
  return [...groups].map(([key, list]) => summarize(key, list)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** A material the farm should look at before an inspection: not listed, not known, or the records disagree. */
export const needsOmriAttention = (material) => material.omriStatus === 'not_listed' || material.omriStatus === 'unknown' || material.statusConflict;

const oneLine = (value) => display(value).slice(0, MAX_PROMPT_VALUE);

/**
 * The materials as text for an AI prompt: one short line each, saying "not recorded" for what is not
 * known, so the AI is not tempted to fill a gap. Values stay on one line and short, so a record's text
 * cannot add instructions of its own.
 */
export function materialsForPrompt(materials) {
  return materials
    .map((m) => {
      const status = `${m.omriStatus}${m.statusConflict ? ' (records disagree)' : ''}`;
      const suppliers = m.suppliers.map(oneLine).join(', ') || 'not recorded';
      return `- ${oneLine(m.name)} | category: ${oneLine(m.category) || 'not recorded'} | suppliers: ${suppliers} | OMRI status: ${status} | last purchased: ${m.lastPurchased ?? 'not recorded'} | applications recorded: ${m.applications}`;
    })
    .join('\n');
}

/** Every supplier of the materials, once each (ignoring case), in alphabetical order. */
export function suppliersOf(materials) {
  const byLower = new Map();
  for (const material of materials) for (const supplier of material.suppliers) if (!byLower.has(supplier.toLowerCase())) byLower.set(supplier.toLowerCase(), supplier);
  return [...byLower.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * How many sprays and amendments were applied, and the dates they cover.
 * @returns {{ sprays: number, amendments: number, first: string | null, last: string | null }}
 */
export function applicationSummary(records) {
  const applied = records.filter((r) => r.status === 'approved' && (r.kind === 'amendment' || (r.kind === 'activity' && r.payload?.activity_type === 'spray')));
  const dates = applied.map((r) => r.record_date).filter(Boolean).sort();
  return {
    sprays: applied.filter((r) => r.kind === 'activity').length,
    amendments: applied.filter((r) => r.kind === 'amendment').length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}

const DAY_MS = 86400000;
const OVERDUE_AFTER_DAYS = 365;
const DUE_SOON_AFTER_DAYS = 270;

/**
 * Whether a material is due for its yearly re-check, going by when it was last bought or used.
 * @param {string | null | undefined} date YYYY-MM-DD
 * @param {string} today YYYY-MM-DD
 * @returns {'overdue' | 'due-soon' | 'ok' | 'unknown'}
 */
export function verificationDue(date, today) {
  if (!date) return 'unknown';
  const then = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(then)) return 'unknown';
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - then) / DAY_MS);
  if (days > OVERDUE_AFTER_DAYS) return 'overdue';
  if (days >= DUE_SOON_AFTER_DAYS) return 'due-soon';
  return 'ok';
}
