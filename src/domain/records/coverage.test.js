import { describe, it, expect } from 'vitest';
import { REPORT_KIND_ORDER } from './report.js';
import { COVERAGE_YEARS, coverageStart, summarizeCoverage, coverageForPrompt } from './coverage.js';

let n = 0;
const rec = (kind, record_date, extra = {}) => ({ id: `r${++n}`, kind, status: 'approved', record_date, payload: {}, ...extra });

describe('coverageStart', () => {
  it('is the first day of the oldest calendar year in a five-year window that ends with this year', () => {
    expect(coverageStart('2026-10-14')).toBe('2022-01-01');
    expect(coverageStart('2026-01-01')).toBe('2022-01-01');
    expect(coverageStart('2026-12-31', 3)).toBe('2024-01-01');
  });

  it('defaults to five years', () => {
    expect(COVERAGE_YEARS).toBe(5);
  });
});

describe('summarizeCoverage', () => {
  const today = '2026-10-14';

  it('lists the five calendar years, oldest first', () => {
    expect(summarizeCoverage([], { today }).years).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it('has a row for every kind of record, in report order, even with nothing in it', () => {
    const { rows } = summarizeCoverage([], { today });
    expect(rows.map((r) => r.kind)).toEqual([...REPORT_KIND_ORDER]);
    expect(rows[0]).toEqual({ kind: 'seed', counts: { 2022: 0, 2023: 0, 2024: 0, 2025: 0, 2026: 0 }, total: 0, first: null, last: null });
  });

  it('counts records by kind and year', () => {
    const { rows, total } = summarizeCoverage([
      rec('activity', '2024-05-01'), rec('activity', '2024-06-01'), rec('activity', '2026-01-01'),
      rec('harvest', '2025-08-01'),
    ], { today });
    const activity = rows.find((r) => r.kind === 'activity');
    expect(activity.counts).toEqual({ 2022: 0, 2023: 0, 2024: 2, 2025: 0, 2026: 1 });
    expect(activity.total).toBe(3);
    expect(rows.find((r) => r.kind === 'harvest').counts[2025]).toBe(1);
    expect(total).toBe(4);
  });

  it('gives the first and last date of each kind, and of everything', () => {
    const result = summarizeCoverage([rec('activity', '2024-05-01'), rec('activity', '2026-01-01'), rec('harvest', '2023-02-02')], { today });
    expect(result.rows.find((r) => r.kind === 'activity')).toMatchObject({ first: '2024-05-01', last: '2026-01-01' });
    expect(result.first).toBe('2023-02-02');
    expect(result.last).toBe('2026-01-01');
  });

  it('finds the first and last date whatever order the records come in', () => {
    const result = summarizeCoverage([rec('activity', '2026-01-01'), rec('activity', '2024-05-01'), rec('activity', '2025-03-03')], { today });
    expect(result.rows.find((r) => r.kind === 'activity')).toMatchObject({ first: '2024-05-01', last: '2026-01-01' });
    expect(result).toMatchObject({ first: '2024-05-01', last: '2026-01-01' });
  });

  it('counts only approved records', () => {
    const { total } = summarizeCoverage([
      rec('activity', '2026-01-01'),
      rec('activity', '2026-01-02', { status: 'draft' }),
      rec('activity', '2026-01-03', { status: 'pending_review' }),
      rec('activity', '2026-01-04', { status: 'rejected' }),
      rec('activity', '2026-01-05', { status: 'voided' }),
    ], { today });
    expect(total).toBe(1);
  });

  it('leaves out records outside the window, with no date, or of a kind it does not know', () => {
    const { total } = summarizeCoverage([
      rec('activity', '2021-12-31'), rec('activity', '2022-01-01'), rec('activity', '2026-12-31'), rec('activity', '2027-01-01'),
      rec('activity', null), rec('mystery', '2025-01-01'),
    ], { today });
    expect(total).toBe(2);
  });

  it('can look at a different number of years', () => {
    const { years, total } = summarizeCoverage([rec('activity', '2024-05-01'), rec('activity', '2023-05-01')], { today, years: 3 });
    expect(years).toEqual([2024, 2025, 2026]);
    expect(total).toBe(1);
  });

  it('does not change the records it is given', () => {
    const records = Object.freeze([Object.freeze(rec('activity', '2026-01-01'))]);
    expect(() => summarizeCoverage(records, { today })).not.toThrow();
  });
});

describe('coverageForPrompt', () => {
  it('writes one line per kind that has records, with the facts and nothing more', () => {
    const coverage = summarizeCoverage([rec('activity', '2025-05-01'), rec('activity', '2026-06-01'), rec('harvest', '2026-08-01')], { today: '2026-10-14' });
    const lines = coverageForPrompt(coverage, 'en').split('\n');
    expect(lines.slice(0, 2)).toEqual([
      '- Activities: 2 records (2025: 1, 2026: 1); first 2025-05-01; last 2026-06-01',
      '- Harvest Log: 1 record (2026: 1); first 2026-08-01; last 2026-08-01',
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/^No records in: /);
  });

  it('says which kinds have no records at all, so a gap is not hidden', () => {
    const coverage = summarizeCoverage([rec('activity', '2026-06-01')], { today: '2026-10-14' });
    const text = coverageForPrompt(coverage, 'en');
    expect(text).toContain('No records in: ');
    expect(text).toContain('Seed Log');
    expect(text).not.toMatch(/No records in:.*Activities/);
  });

  it('says there are no records when there are none', () => {
    expect(coverageForPrompt(summarizeCoverage([], { today: '2026-10-14' }), 'en')).toBe('No approved records in this period.');
  });

  it('names the kinds in the language asked for', () => {
    const coverage = summarizeCoverage([rec('harvest', '2026-08-01')], { today: '2026-10-14' });
    expect(coverageForPrompt(coverage, 'es')).toContain('Registro de Cosecha');
  });
});
