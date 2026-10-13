import { describe, it, expect } from 'vitest';
import { parseViewFilter, matchesFilter, applyFilterToQuery, DEFAULT_SAVED_VIEWS, MAX_VIEW_CONDITIONS } from './savedViews.js';

const farm = { season_start_month: 4, season_start_day: 1 };
const ctx = { farm, today: '2026-10-12' }; // current season: 2026-04-01 → 2027-04-01

const rec = (kind, record_date, payload = {}, status = 'approved') => ({ kind, record_date, payload, status });

const SAMPLE = [
  rec('purchase', '2026-05-01', { product: 'Compost', omri_status: 'listed' }),
  rec('purchase', '2026-05-02', { product: 'Mystery', omri_status: 'unknown' }),
  rec('purchase', '2026-05-03', { product: 'Spray X', omri_status: 'not_listed' }),
  rec('purchase', '2026-05-04', { product: 'No status' }),
  rec('purchase', '2026-05-05', { product: 'Tools', omri_status: 'not_applicable' }),
  rec('purchase', '2025-06-01', { product: 'Old unknown', omri_status: 'unknown' }),
  rec('purchase', '2026-05-06', { product: 'Pending unknown', omri_status: 'unknown' }, 'pending_review'),
  rec('activity', '2026-06-01', { activity_type: 'spray', field: 'B4', product: 'Bt' }),
  rec('activity', '2026-06-02', { activity_type: 'irrigation', field: 'B4' }),
  rec('activity', '2025-06-01', { activity_type: 'spray', field: 'A1' }),
  rec('activity', '2026-06-03', { activity_type: 'spray', field: 'C2' }, 'pending_review'),
  rec('harvest', '2026-08-01', { crop: 'Lettuce', quantity: 10, unit: 'lb' }),
  rec('harvest', '2025-08-01', { crop: 'Lettuce', quantity: 9, unit: 'lb' }),
  rec('harvest', null, { crop: 'Undated', quantity: 1, unit: 'lb' }),
];

const products = (rows) => rows.map((r) => r.payload.product ?? r.payload.crop ?? r.payload.field).sort();

describe('parseViewFilter', () => {
  it('accepts an empty filter and fills in defaults (approved records only, all time)', () => {
    expect(parseViewFilter({})).toEqual({ ok: true, value: { status: ['approved'], season: 'all', where: [] } });
  });

  it('accepts a full filter', () => {
    const r = parseViewFilter({ kinds: ['activity'], status: ['approved', 'pending_review'], season: 'current', where: [{ field: 'payload.activity_type', op: 'eq', value: 'spray' }] });
    expect(r.ok).toBe(true);
  });

  it.each([
    ['an unknown key', { sql: 'drop table records' }],
    ['an unknown kind', { kinds: ['bogus'] }],
    ['an unknown status', { status: ['archived'] }],
    ['an unknown season', { season: 'forever' }],
    ['an unknown operator', { where: [{ field: 'payload.x', op: 'like', value: 'a' }] }],
    ['a top-level column as a field', { where: [{ field: 'farm_id', op: 'eq', value: 'a' }] }],
    ['a field with a path or quote', { where: [{ field: "payload.x'; --", op: 'eq', value: 'a' }] }],
    ['a field with uppercase or digits', { where: [{ field: 'payload.Name1', op: 'eq', value: 'a' }] }],
    ['a value with a comma (query-syntax injection)', { where: [{ field: 'payload.x', op: 'eq', value: 'a,b' }] }],
    ['a value with parentheses', { where: [{ field: 'payload.x', op: 'in', value: ['a)', 'b'] }] }],
    ['a value that is too long', { where: [{ field: 'payload.x', op: 'eq', value: 'a'.repeat(61) }] }],
    ['an in-list that is not an array', { where: [{ field: 'payload.x', op: 'in', value: 'a' }] }],
    ['an eq with an array value', { where: [{ field: 'payload.x', op: 'eq', value: ['a'] }] }],
    ['a missing value for eq', { where: [{ field: 'payload.x', op: 'eq' }] }],
    ['too many conditions', { where: Array.from({ length: MAX_VIEW_CONDITIONS + 1 }, () => ({ field: 'payload.x', op: 'is_null' })) }],
    ['not an object', 'select *'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(parseViewFilter(input).ok).toBe(false);
  });

  it('accepts is_null / not_null without a value', () => {
    expect(parseViewFilter({ where: [{ field: 'payload.omri_status', op: 'is_null' }, { field: 'payload.lot', op: 'not_null' }] }).ok).toBe(true);
  });
});

describe('default saved views (the pinned views from the product spec)', () => {
  const run = (slug) => {
    const view = DEFAULT_SAVED_VIEWS.find((v) => v.slug === slug);
    const parsed = parseViewFilter(view.filter);
    expect(parsed.ok, slug).toBe(true);
    return SAMPLE.filter((r) => matchesFilter(r, parsed.value, ctx));
  };

  it('has exactly the four views, each with an English and Spanish name', () => {
    expect(DEFAULT_SAVED_VIEWS.map((v) => v.slug)).toEqual([
      'purchases-without-omri', 'this-seasons-sprays', 'this-seasons-harvests', 'this-seasons-purchases',
    ]);
    for (const v of DEFAULT_SAVED_VIEWS) expect(v.name.en && v.name.es, v.slug).toBeTruthy();
  });

  it('"Purchases without OMRI listing" = approved purchases whose status is not listed, including a missing status', () => {
    expect(products(run('purchases-without-omri'))).toEqual(['Mystery', 'No status', 'Old unknown', 'Spray X']);
  });

  it('"This season’s sprays" = approved sprays dated in the current season only', () => {
    expect(run('this-seasons-sprays')).toEqual([SAMPLE[7]]); // the approved spray of Bt on B4 (2026-06-01)
  });

  it('"This season’s harvests" excludes last season and undated records', () => {
    expect(products(run('this-seasons-harvests'))).toEqual(['Lettuce']);
    expect(run('this-seasons-harvests')).toHaveLength(1);
  });

  it('"This season’s purchases" covers every approved purchase in the current season', () => {
    expect(products(run('this-seasons-purchases'))).toEqual(['Compost', 'Mystery', 'No status', 'Spray X', 'Tools']);
  });
});

describe('matchesFilter', () => {
  const f = (filter) => parseViewFilter(filter).value;

  it('treats neq and nin as true when the field is missing', () => {
    expect(matchesFilter(rec('purchase', '2026-05-01', {}), f({ where: [{ field: 'payload.omri_status', op: 'neq', value: 'listed' }] }), ctx)).toBe(true);
    expect(matchesFilter(rec('purchase', '2026-05-01', {}), f({ where: [{ field: 'payload.omri_status', op: 'nin', value: ['listed'] }] }), ctx)).toBe(true);
  });

  it('treats eq and in as false when the field is missing', () => {
    expect(matchesFilter(rec('purchase', '2026-05-01', {}), f({ where: [{ field: 'payload.omri_status', op: 'eq', value: 'listed' }] }), ctx)).toBe(false);
    expect(matchesFilter(rec('purchase', '2026-05-01', {}), f({ where: [{ field: 'payload.omri_status', op: 'in', value: ['listed'] }] }), ctx)).toBe(false);
  });

  it('compares numbers and strings by their text form', () => {
    expect(matchesFilter(rec('harvest', '2026-08-01', { quantity: 10 }), f({ where: [{ field: 'payload.quantity', op: 'eq', value: '10' }] }), ctx)).toBe(true);
  });

  it('supports the previous season', () => {
    const prev = f({ season: 'previous' });
    expect(matchesFilter(rec('harvest', '2025-08-01'), prev, ctx)).toBe(true);
    expect(matchesFilter(rec('harvest', '2026-08-01'), prev, ctx)).toBe(false);
  });

  it('includes the first day of a season and excludes the first day of the next', () => {
    const cur = f({ season: 'current' });
    expect(matchesFilter(rec('note', '2026-04-01'), cur, ctx)).toBe(true);
    expect(matchesFilter(rec('note', '2027-04-01'), cur, ctx)).toBe(false);
    expect(matchesFilter(rec('note', '2026-03-31'), cur, ctx)).toBe(false);
  });

  it('shows pending records only when the view asks for them', () => {
    expect(matchesFilter(rec('note', '2026-05-01', {}, 'pending_review'), f({}), ctx)).toBe(false);
    expect(matchesFilter(rec('note', '2026-05-01', {}, 'pending_review'), f({ status: ['pending_review'] }), ctx)).toBe(true);
  });
});

// ── The database query must agree with the in-memory matcher ────────────────

/** A tiny interpreter for exactly the supabase-js calls applyFilterToQuery makes. */
class MemoryQuery {
  constructor(rows) { this.rows = rows; }
  col(name) {
    const m = /^payload->>(.+)$/.exec(name);
    return (r) => (m ? (r.payload?.[m[1]] ?? null) : (r[name] ?? null));
  }
  keep(fn) { this.rows = this.rows.filter(fn); return this; }
  in(col, values) { const get = this.col(col); return this.keep((r) => get(r) !== null && values.map(String).includes(String(get(r)))); }
  eq(col, value) { const get = this.col(col); return this.keep((r) => get(r) !== null && String(get(r)) === String(value)); }
  gte(col, value) { const get = this.col(col); return this.keep((r) => get(r) !== null && get(r) >= value); }
  lt(col, value) { const get = this.col(col); return this.keep((r) => get(r) !== null && get(r) < value); }
  is(col, value) { const get = this.col(col); return this.keep((r) => (value === null ? get(r) === null : get(r) === value)); }
  not(col, op, value) { const get = this.col(col); return this.keep((r) => !(op === 'is' && value === null ? get(r) === null : false)); }
  or(expr) {
    const parts = expr.split(/,(?![^()]*\))/); // split on commas outside parentheses
    const tests = parts.map((p) => {
      const m = /^(.+?)\.(is\.null|neq\.(.*)|not\.in\.\((.*)\))$/.exec(p);
      const get = this.col(m[1]);
      if (m[2] === 'is.null') return (r) => get(r) === null;
      if (m[2].startsWith('neq.')) return (r) => get(r) !== null && String(get(r)) !== m[3];
      const list = m[4].split(',');
      return (r) => get(r) !== null && !list.includes(String(get(r)));
    });
    return this.keep((r) => tests.some((t) => t(r)));
  }
}

describe('applyFilterToQuery agrees with matchesFilter', () => {
  const FILTERS = [
    ...DEFAULT_SAVED_VIEWS.map((v) => [v.slug, v.filter]),
    ['pending purchases', { kinds: ['purchase'], status: ['pending_review'] }],
    ['previous season harvests', { kinds: ['harvest'], season: 'previous' }],
    ['not null lot', { where: [{ field: 'payload.crop', op: 'not_null' }] }],
    ['null omri', { kinds: ['purchase'], where: [{ field: 'payload.omri_status', op: 'is_null' }] }],
    ['in list', { kinds: ['activity'], where: [{ field: 'payload.activity_type', op: 'in', value: ['spray', 'irrigation'] }] }],
    ['neq', { kinds: ['purchase'], where: [{ field: 'payload.omri_status', op: 'neq', value: 'listed' }] }],
    ['two conditions', { kinds: ['purchase'], where: [{ field: 'payload.omri_status', op: 'nin', value: ['listed'] }, { field: 'payload.product', op: 'neq', value: 'Mystery' }] }],
  ];

  it.each(FILTERS)('%s', (_name, rawFilter) => {
    const filter = parseViewFilter(rawFilter).value;
    const viaQuery = applyFilterToQuery(new MemoryQuery(SAMPLE), filter, ctx).rows;
    const viaMemory = SAMPLE.filter((r) => matchesFilter(r, filter, ctx));
    expect(viaQuery).toEqual(viaMemory);
  });
});
