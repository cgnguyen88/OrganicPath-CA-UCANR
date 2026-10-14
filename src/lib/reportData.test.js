import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A stand-in for a supabase-js query on a table that holds `rows`. It records every call, and when it
 * is awaited it answers with the slice that the last `.range(from, to)` asked for (inclusive, like Postgres).
 */
function tableQuery(rows, { fails = false, cap = Infinity, scripted = false } = {}) {
  const calls = [];
  let range = [0, rows.length - 1];
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'calls') return calls;
      if (prop === 'then') {
        return (resolve, reject) => {
          const result = fails
            ? { data: null, error: { code: '42501', message: 'denied' } }
            : { data: scripted ? rows : rows.slice(range[0], Math.min(range[1] + 1, range[0] + cap)), error: null };
          return Promise.resolve(result).then(resolve, reject);
        };
      }
      return (...args) => {
        calls.push([prop, ...args]);
        if (prop === 'range') range = args;
        return proxy;
      };
    },
  });
  return proxy;
}

const from = vi.fn();
vi.mock('./supabase.js', () => ({ supabase: { from: (...a) => from(...a) } }));

const { listRecordsForReport, listSavedViewRecordsForReport, EXPORT_PAGE_SIZE, EXPORT_RECORD_LIMIT, REPORT_COLUMNS } = await import('./reportData.js');

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
const FARM = { id: 'farm-1', season_start_month: 4, season_start_day: 1 };
const queries = [];
/** Every query the code under test made, in order. */
function serve(data, { failAtPage, cap } = {}) {
  queries.length = 0;
  from.mockImplementation(() => {
    const q = tableQuery(data, { fails: queries.length === failAtPage, cap });
    queries.push(q);
    return q;
  });
}
/** Each request gets the next scripted page, whatever range it asked for. */
function servePages(pages) {
  queries.length = 0;
  from.mockImplementation(() => {
    const q = tableQuery(pages[queries.length] ?? [], { scripted: true });
    queries.push(q);
    return q;
  });
}
const names = (q) => q.calls.map((c) => c[0]);
const args = (q, name) => q.calls.filter((c) => c[0] === name).map((c) => c.slice(1));

beforeEach(() => {
  from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('listRecordsForReport', () => {
  it('asks only for this farm’s approved records, newest first, in a stable order', async () => {
    serve(rows(3));
    const result = await listRecordsForReport({ farmId: 'farm-1' });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ records: rows(3), truncated: false });
    expect(from).toHaveBeenCalledWith('records');
    const q = queries[0];
    expect(args(q, 'eq')).toEqual([['farm_id', 'farm-1']]);
    expect(args(q, 'in')).toContainEqual(['status', ['approved']]);
    expect(args(q, 'order').map((a) => a[0])).toEqual(['record_date', 'created_at', 'id']);
  });

  it('adds work in progress (but never rejected or voided records) when asked', async () => {
    serve(rows(1));
    await listRecordsForReport({ farmId: 'farm-1', includeUnapproved: true });
    const status = args(queries[0], 'in').find(([column]) => column === 'status')[1];
    expect(status.sort()).toEqual(['approved', 'draft', 'needs_info', 'pending_review']);
  });

  it('limits to the chosen kinds, ignoring any it does not know', async () => {
    serve(rows(1));
    await listRecordsForReport({ farmId: 'farm-1', kinds: ['activity', 'bogus', 'harvest'] });
    expect(args(queries[0], 'in')).toContainEqual(['kind', ['activity', 'harvest']]);
  });

  it('asks for every kind when none are named', async () => {
    serve(rows(1));
    await listRecordsForReport({ farmId: 'farm-1' });
    const kinds = args(queries[0], 'in').find(([column]) => column === 'kind')[1];
    expect(kinds).toHaveLength(9);
  });

  it('gives an empty report, without asking the database, when no known kind is chosen', async () => {
    const result = await listRecordsForReport({ farmId: 'farm-1', kinds: ['bogus'] });
    expect(result).toEqual({ data: { records: [], truncated: false }, error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it('limits to the period, both ends included', async () => {
    serve(rows(1));
    await listRecordsForReport({ farmId: 'farm-1', from: '2026-04-01', to: '2027-03-31' });
    expect(args(queries[0], 'gte')).toEqual([['record_date', '2026-04-01']]);
    expect(args(queries[0], 'lte')).toEqual([['record_date', '2027-03-31']]);
  });

  it('does not limit dates when no period is given', async () => {
    serve(rows(1));
    await listRecordsForReport({ farmId: 'farm-1' });
    expect(names(queries[0])).not.toContain('gte');
    expect(names(queries[0])).not.toContain('lte');
  });

  it.each([
    ['a date that is not a date', { from: '2026-13-45' }],
    ['text in place of a date', { to: "2026-01-01' or 1=1" }],
    ['a period that ends before it starts', { from: '2026-05-01', to: '2026-04-01' }],
    ['no farm', { farmId: '' }],
  ])('refuses %s without asking the database', async (_label, extra) => {
    const result = await listRecordsForReport({ farmId: 'farm-1', ...extra });
    expect(result.data).toBeNull();
    expect(result.error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });

  it('reads long lists page by page and puts them together', async () => {
    serve(rows(EXPORT_PAGE_SIZE * 2 + 500));
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(result.data.records).toHaveLength(EXPORT_PAGE_SIZE * 2 + 500);
    expect(result.data.records[0].id).toBe('r0');
    expect(result.data.records.at(-1).id).toBe(`r${EXPORT_PAGE_SIZE * 2 + 499}`);
    expect(result.data.truncated).toBe(false);
    expect(queries.map((q) => args(q, 'range')[0])).toEqual([[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
  });

  it('reads only the columns a report needs, not the attachments or other bulky data', async () => {
    serve(rows(1));
    await listRecordsForReport({ farmId: 'farm-1' });
    const [columns] = args(queries[0], 'select')[0];
    expect(columns).toBe(REPORT_COLUMNS);
    for (const needed of ['id', 'kind', 'status', 'record_date', 'payload', 'source', 'reviewed_at', 'created_at']) expect(columns.split(',').map((c) => c.trim())).toContain(needed);
    expect(columns).not.toMatch(/attachments|\*/);
  });

  it('gets every record even when the server sends fewer rows per request than were asked for', async () => {
    serve(rows(1000), { cap: 400 });
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(result.error).toBeNull();
    expect(result.data.records).toHaveLength(1000);
    expect(result.data.records.at(-1).id).toBe('r999');
    expect(result.data.truncated).toBe(false);
    expect(queries.map((q) => args(q, 'range')[0][0])).toEqual([0, 400, 800, 1000]); // each page picks up where the last stopped
  });

  it('does not list a record twice when records move between pages while it reads', async () => {
    const page1 = rows(EXPORT_PAGE_SIZE);
    const page2 = [{ id: 'r999' }, { id: 'new-1' }, { id: 'new-2' }]; // r999 slid down into the second page
    servePages([page1, page2, []]);
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    const ids = result.data.records.map((r) => r.id);
    expect(ids).toHaveLength(EXPORT_PAGE_SIZE + 2);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(-2)).toEqual(['new-1', 'new-2']);
  });

  it('keeps going from where it really is when some rows were repeated', async () => {
    servePages([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], [{ id: 'c' }, { id: 'd' }], []]);
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(queries.map((q) => args(q, 'range')[0][0])).toEqual([0, 2, 4, 6]); // counts what the server sent, repeats included
    expect(result.data.records.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('asks for one more page when the last one was full, in case that was everything', async () => {
    serve(rows(EXPORT_PAGE_SIZE));
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(result.data.records).toHaveLength(EXPORT_PAGE_SIZE);
    expect(result.data.truncated).toBe(false);
    expect(queries).toHaveLength(2);
  });

  it('stops at the limit and says the list was cut short', async () => {
    serve(rows(EXPORT_RECORD_LIMIT + 1));
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(result.data.records).toHaveLength(EXPORT_RECORD_LIMIT);
    expect(result.data.truncated).toBe(true);
  });

  it('does not call a list cut short when it is exactly the limit', async () => {
    serve(rows(EXPORT_RECORD_LIMIT));
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(result.data.records).toHaveLength(EXPORT_RECORD_LIMIT);
    expect(result.data.truncated).toBe(false);
  });

  it('does not claim a list is complete when the check for anything beyond the limit fails', async () => {
    serve(rows(EXPORT_RECORD_LIMIT), { failAtPage: EXPORT_RECORD_LIMIT / EXPORT_PAGE_SIZE });
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(result.data).toBeNull();
    expect(result.error.code).toBe('forbidden');
  });

  it('never returns half a list: an error on a later page is an error', async () => {
    serve(rows(EXPORT_PAGE_SIZE * 3), { failAtPage: 1 });
    const result = await listRecordsForReport({ farmId: 'farm-1' });
    expect(result.data).toBeNull();
    expect(result.error.code).toBe('forbidden');
    expect(queries).toHaveLength(2);
  });
});

describe('listSavedViewRecordsForReport', () => {
  const view = { id: 'v1', filter: { kinds: ['activity'], status: ['approved'], season: 'current', where: [{ field: 'payload.activity_type', op: 'eq', value: 'spray' }] } };
  const ctx = { farm: FARM, today: '2026-10-14' };

  it('runs the view’s own filter for this farm, for this season', async () => {
    serve(rows(2));
    const result = await listSavedViewRecordsForReport(view, ctx);
    expect(result.data).toEqual({ records: rows(2), truncated: false });
    const q = queries[0];
    expect(args(q, 'eq')).toContainEqual(['farm_id', 'farm-1']);
    expect(args(q, 'eq')).toContainEqual(['payload->>activity_type', 'spray']);
    expect(args(q, 'gte')).toEqual([['record_date', '2026-04-01']]);
    expect(args(q, 'lt')).toEqual([['record_date', '2027-04-01']]);
    expect(args(q, 'in')).toContainEqual(['status', ['approved']]);
  });

  it('refuses a view whose stored filter is malformed, without asking the database', async () => {
    const result = await listSavedViewRecordsForReport({ id: 'v2', filter: { sql: 'drop table records' } }, ctx);
    expect(result.error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });

  it('reads only the columns a report needs for a view too, and never repeats a record', async () => {
    servePages([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }], []]);
    const result = await listSavedViewRecordsForReport(view, ctx);
    expect(args(queries[0], 'select')[0][0]).toBe(REPORT_COLUMNS);
    expect(result.data.records.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('pages through a long view and reports when it is cut short', async () => {
    serve(rows(EXPORT_RECORD_LIMIT + 3));
    const result = await listSavedViewRecordsForReport(view, ctx);
    expect(result.data.records).toHaveLength(EXPORT_RECORD_LIMIT);
    expect(result.data.truncated).toBe(true);
  });

  it('gives an error, not a partial list, when a page fails', async () => {
    serve(rows(EXPORT_PAGE_SIZE * 2), { failAtPage: 1 });
    const result = await listSavedViewRecordsForReport(view, ctx);
    expect(result.data).toBeNull();
    expect(result.error.code).toBe('forbidden');
  });
});
