import { cleanText } from './csv.js';
import { materialKey, newestFirst } from './materials.js';

/**
 * What a farm has in stock now, worked out from its approved stock counts (the `inventory` records). A count
 * says how much of an item was on hand on a day, so the current stock of an item is its latest count; earlier
 * counts stay as the history. The reorder level and the OMRI status are set once and carry forward through
 * later counts that do not repeat them. An item counted in two units is two rows: bags are not yards.
 */

/** What a count may say (including "unknown": the person looked and does not know). */
const COUNT_OMRI = ['listed', 'not_listed', 'not_applicable', 'unknown'];
/** What the purchase and input records can tell: "unknown" there means nobody said. */
const KNOWN_OMRI = ['listed', 'not_listed', 'not_applicable'];

const tidy = (value) => cleanText(value).replace(/\s+/g, ' ').trim();

/** @returns {number | null} a number of zero or more, or null for blank and for what is not a number */
function parseCount(value) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const firstWhere = (records, pick) => {
  for (const record of records) {
    const value = pick(record);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

function statusOf(quantity, reorderLevel) {
  if (quantity <= 0) return 'out';
  if (reorderLevel === null) return 'no_level';
  return quantity <= reorderLevel ? 'low' : 'ok';
}

const RANK = { out: 0, low: 1 };

function summarize(counts, materialsByKey) {
  const sorted = [...counts].sort(newestFirst);
  const latest = sorted[0];
  const item = tidy(latest.payload.item);
  const reorderLevel = firstWhere(sorted, (r) => parseCount(r.payload.reorder_level)) ?? null;
  const quantity = parseCount(latest.payload.quantity);

  const countOmri = firstWhere(sorted, (r) => (COUNT_OMRI.includes(r.payload.omri_status) ? r.payload.omri_status : undefined));
  const material = materialsByKey.get(materialKey(item));
  const materialOmri = material && KNOWN_OMRI.includes(material.omriStatus) ? material.omriStatus : undefined;
  const omriStatus = countOmri ?? materialOmri ?? 'unknown';

  // A place stays the same from count to count; a lot belongs to one delivery, so it is the latest count's only.
  const location = firstWhere(sorted, (r) => tidy(r.payload.location)) ?? '';
  const lotNumber = tidy(latest.payload.lot_number);
  const unit = tidy(latest.payload.unit);

  return {
    key: `${materialKey(item)}|${materialKey(unit)}`,
    item,
    unit,
    quantity,
    reorderLevel,
    status: statusOf(quantity, reorderLevel),
    omriStatus,
    omriSource: countOmri ? 'count' : materialOmri ? 'records' : 'none',
    statusConflict: !countOmri && Boolean(material?.statusConflict),
    location,
    lotNumber,
    lastCounted: latest.record_date ?? null,
    startingValues: {
      item,
      unit,
      ...(reorderLevel === null ? {} : { reorder_level: String(reorderLevel) }),
      ...(countOmri ? { omri_status: countOmri } : {}),
      ...(location ? { location } : {}),
      ...(lotNumber ? { lot_number: lotNumber } : {}),
    },
  };
}

/**
 * @param {object[]} records any records; only approved stock counts are used
 * @param {Array<{ key: string, omriStatus: string, statusConflict?: boolean }>} [materials] from `summarizeMaterials`, to say whether an item is OMRI listed when the counts do not
 * @returns {Array<{
 *   key: string, item: string, unit: string, quantity: number, reorderLevel: number | null,
 *   status: 'out' | 'low' | 'ok' | 'no_level', omriStatus: 'listed' | 'not_listed' | 'not_applicable' | 'unknown',
 *   omriSource: 'count' | 'records' | 'none', statusConflict: boolean, location: string, lotNumber: string,
 *   lastCounted: string | null, startingValues: Record<string, string>,
 * }>} one row per item and unit; what is out first, then what is low, then the rest by name
 */
export function summarizeInventory(records, materials = []) {
  const materialsByKey = new Map(materials.map((m) => [m.key, m]));
  const groups = new Map();
  for (const record of records) {
    if (record.kind !== 'inventory' || record.status !== 'approved') continue;
    const item = tidy(record.payload?.item);
    if (materialKey(item) === '' || parseCount(record.payload?.quantity) === null) continue;
    const key = `${materialKey(item)}|${materialKey(tidy(record.payload?.unit))}`;
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }
  return [...groups.values()]
    .map((counts) => summarize(counts, materialsByKey))
    .sort((a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2) || a.item.localeCompare(b.item, undefined, { sensitivity: 'base' }));
}

/** Out of stock, or at or below its reorder level. @param {{ status: string }} row */
export const isLowStock = (row) => row.status === 'out' || row.status === 'low';

/** The rows to reorder, in the order `summarizeInventory` gives them (out first). */
export const lowStockRows = (rows) => rows.filter(isLowStock);
