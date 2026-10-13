import { z } from 'zod';
import { RECORD_KINDS, RECORD_STATUSES } from './kinds.js';
import { seasonRange } from './seasons.js';

/**
 * Saved views are DATA a user can edit, so their filters are a small declarative language,
 * never SQL: whitelisted shapes, operators, and a restricted value alphabet (so a value can
 * never smuggle query syntax into the database request).
 *
 *   { kinds?, status? (default ['approved']), season? ('current'|'previous'|'all'),
 *     where? [{ field: 'payload.<name>', op, value? }] }
 */

export const MAX_VIEW_CONDITIONS = 10;
const MAX_LIST_VALUES = 20;
/** No comma, parenthesis, quote or other query-syntax character. */
const SAFE_VALUE = /^[A-Za-z0-9_ .-]{0,60}$/;

const scalar = z.union([z.string().regex(SAFE_VALUE), z.number().finite()]);
const field = z.string().regex(/^payload\.[a-z_]{1,40}$/);

const condition = z.union([
  z.object({ field, op: z.enum(['eq', 'neq']), value: scalar }).strict(),
  z.object({ field, op: z.enum(['in', 'nin']), value: z.array(scalar).min(1).max(MAX_LIST_VALUES) }).strict(),
  z.object({ field, op: z.enum(['is_null', 'not_null']) }).strict(),
]);

const filterSchema = z
  .object({
    kinds: z.array(z.enum(RECORD_KINDS)).min(1).optional(),
    status: z.array(z.enum(RECORD_STATUSES)).min(1).default(['approved']),
    season: z.enum(['current', 'previous', 'all']).default('all'),
    where: z.array(condition).max(MAX_VIEW_CONDITIONS).default([]),
  })
  .strict();

/**
 * @param {unknown} input
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseViewFilter(input) {
  const parsed = filterSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'Invalid view filter.' };
}

const keyOf = (condField) => condField.slice('payload.'.length);
const present = (v) => v !== undefined && v !== null && v !== '';
const asStrings = (values) => values.map(String);

function seasonBounds(filter, ctx) {
  if (filter.season === 'current') return seasonRange(ctx.farm, ctx.today, 0);
  if (filter.season === 'previous') return seasonRange(ctx.farm, ctx.today, -1);
  return null;
}

function matchesCondition(record, cond) {
  const value = record.payload?.[keyOf(cond.field)];
  switch (cond.op) {
    case 'eq': return present(value) && String(value) === String(cond.value);
    case 'neq': return !present(value) || String(value) !== String(cond.value);
    case 'in': return present(value) && asStrings(cond.value).includes(String(value));
    case 'nin': return !present(value) || !asStrings(cond.value).includes(String(value));
    case 'is_null': return !present(value);
    case 'not_null': return present(value);
    default: return false;
  }
}

/**
 * In-memory evaluation of a (parsed) view filter against one record.
 * @param {{ kind: string, status: string, record_date?: string | null, payload?: Record<string, unknown> }} record
 * @param {object} filter a value returned by parseViewFilter
 * @param {{ farm: { season_start_month?: number, season_start_day?: number } | null, today: string | Date }} ctx
 */
export function matchesFilter(record, filter, ctx) {
  if (filter.kinds && !filter.kinds.includes(record.kind)) return false;
  if (!(filter.status ?? ['approved']).includes(record.status)) return false;

  const bounds = seasonBounds(filter, ctx);
  if (bounds && !(record.record_date && record.record_date >= bounds.start && record.record_date < bounds.end)) return false;

  return (filter.where ?? []).every((cond) => matchesCondition(record, cond));
}

/**
 * Apply a (parsed) view filter to a supabase-js query on `records`. Missing fields count as
 * "not equal / not in", exactly as matchesFilter does (SQL's NULL <> x would otherwise drop
 * them), which is why neq/nin use an explicit `is null` alternative.
 *
 * @template T
 * @param {T} query a supabase-js filter builder for the records table
 * @param {object} filter a value returned by parseViewFilter
 * @param {{ farm: object | null, today: string | Date }} ctx
 * @returns {T}
 */
export function applyFilterToQuery(query, filter, ctx) {
  let q = query;
  if (filter.kinds) q = q.in('kind', filter.kinds);
  q = q.in('status', filter.status ?? ['approved']);

  const bounds = seasonBounds(filter, ctx);
  if (bounds) q = q.gte('record_date', bounds.start).lt('record_date', bounds.end);

  for (const cond of filter.where ?? []) {
    const col = `payload->>${keyOf(cond.field)}`;
    switch (cond.op) {
      case 'eq': q = q.eq(col, String(cond.value)); break;
      case 'neq': q = q.or(`${col}.is.null,${col}.neq.${cond.value}`); break;
      case 'in': q = q.in(col, asStrings(cond.value)); break;
      case 'nin': q = q.or(`${col}.is.null,${col}.not.in.(${asStrings(cond.value).join(',')})`); break;
      case 'is_null': q = q.is(col, null); break;
      case 'not_null': q = q.not(col, 'is', null); break;
      default: break;
    }
  }
  return q;
}

/** The pinned views every farm starts with. The database seeds the same filters (a test keeps them in sync). */
export const DEFAULT_SAVED_VIEWS = Object.freeze([
  {
    slug: 'purchases-without-omri',
    name: { en: 'Purchases without OMRI listing', es: 'Compras sin listado OMRI' },
    filter: {
      kinds: ['purchase'],
      status: ['approved'],
      season: 'all',
      where: [{ field: 'payload.omri_status', op: 'nin', value: ['listed', 'not_applicable'] }],
    },
  },
  {
    slug: 'this-seasons-sprays',
    name: { en: 'This season’s sprays', es: 'Aplicaciones de esta temporada' },
    filter: {
      kinds: ['activity'],
      status: ['approved'],
      season: 'current',
      where: [{ field: 'payload.activity_type', op: 'eq', value: 'spray' }],
    },
  },
  {
    slug: 'this-seasons-harvests',
    name: { en: 'This season’s harvests', es: 'Cosechas de esta temporada' },
    filter: { kinds: ['harvest'], status: ['approved'], season: 'current', where: [] },
  },
  {
    slug: 'this-seasons-purchases',
    name: { en: 'This season’s purchases', es: 'Compras de esta temporada' },
    filter: { kinds: ['purchase'], status: ['approved'], season: 'current', where: [] },
  },
]);
