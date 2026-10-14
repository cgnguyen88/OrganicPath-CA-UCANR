import { supabase } from './supabase.js';
import { RECORD_KINDS } from '../domain/records/kinds.js';
import { isValidIsoDate } from '../domain/records/schemas.js';
import { parseViewFilter, applyFilterToQuery } from '../domain/records/savedViews.js';
import { reportStatuses } from '../domain/records/report.js';
import { describeRecordError } from './records.js';

/**
 * Reads the records for an export. Unlike the on-screen lists (which show the newest 500), an export
 * has to be complete, so it reads page by page up to EXPORT_RECORD_LIMIT and says when it stopped there.
 * Everything runs as the signed-in person, so row-level security still decides what they can see.
 *
 * Every function resolves to `{ data: { records, truncated }, error }` and never throws.
 */

/** supabase returns at most this many rows per request by default (a project may set it lower). */
export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_RECORD_LIMIT = 5000;
/** What a report uses of a record. Attachments and the rest are left behind: they can be large and are never shown. */
export const REPORT_COLUMNS = 'id, kind, status, record_date, payload, source, reviewed_at, created_at';

const fail = (code, extra = {}) => ({ data: null, error: { code, ...extra } });
const done = (records, truncated) => ({ data: { records, truncated }, error: null });

function failure(dbError) {
  const described = describeRecordError(dbError);
  if (described.code === 'unknown') console.error('report export:', dbError);
  return { data: null, error: described };
}

/** Newest first, with the id as a last tie-break so that, while nothing changes, paging neither repeats nor skips a row. */
const stableNewestFirst = (query) =>
  query.order('record_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).order('id', { ascending: false });

/**
 * Reads page after page until the server has nothing more (or the limit is reached). It does not treat a
 * short page as the last one: the server may send fewer rows per request than were asked for. Because the
 * list is read over a moment in time, a record added or approved meanwhile can slide into the next page,
 * so a record is kept only the first time it is seen.
 */
async function fetchAll(makeQuery) {
  const seen = new Set();
  let records = [];
  let fetched = 0;
  while (fetched < EXPORT_RECORD_LIMIT) {
    const end = Math.min(fetched + EXPORT_PAGE_SIZE, EXPORT_RECORD_LIMIT) - 1;
    const { data, error } = await makeQuery().range(fetched, end);
    if (error) return failure(error);
    const page = data ?? [];
    if (page.length === 0) return done(records, false);
    fetched += page.length;
    records = records.concat(page.filter((record) => !seen.has(record.id) && seen.add(record.id)));
  }
  // The limit is reached: is there anything beyond it?
  const probe = await makeQuery().range(EXPORT_RECORD_LIMIT, EXPORT_RECORD_LIMIT);
  if (probe.error) return failure(probe.error);
  return done(records, (probe.data ?? []).length > 0);
}

const recordsOf = (farmId) => supabase.from('records').select(REPORT_COLUMNS).eq('farm_id', farmId);

/**
 * @param {{ farmId: string, kinds?: string[], includeUnapproved?: boolean, from?: string, to?: string }} options
 *   `from` and `to` are the first and last day, both included.
 */
export async function listRecordsForReport({ farmId, kinds, includeUnapproved = false, from, to }) {
  if (typeof farmId !== 'string' || farmId === '') return fail('invalid');
  if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to)) || (from && to && from > to)) return fail('invalid');

  const wanted = kinds === undefined ? RECORD_KINDS : RECORD_KINDS.filter((kind) => kinds.includes(kind));
  if (wanted.length === 0) return done([], false);

  const statuses = reportStatuses(includeUnapproved);
  return fetchAll(() => {
    let q = recordsOf(farmId).in('kind', wanted).in('status', statuses);
    if (from) q = q.gte('record_date', from);
    if (to) q = q.lte('record_date', to);
    return stableNewestFirst(q);
  });
}

/**
 * The records of a saved view, as the view itself defines them.
 * @param {{ filter: unknown }} view
 * @param {{ farm: { id: string, season_start_month?: number, season_start_day?: number }, today: string | Date }} ctx
 */
export async function listSavedViewRecordsForReport(view, ctx) {
  const parsed = parseViewFilter(view.filter);
  if (!parsed.ok) return fail('invalid', { message: parsed.error });
  return fetchAll(() => stableNewestFirst(applyFilterToQuery(recordsOf(ctx.farm.id), parsed.value, ctx)));
}
