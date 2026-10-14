import { KIND_META } from './kinds.js';
import { REPORT_KIND_ORDER } from './report.js';

/**
 * How well a farm's records cover the years an inspector can ask about (records are kept five years):
 * for every kind of record, how many approved records there are in each calendar year, and the first and
 * last date. Gaps show up as zeros, which is the point.
 */

export const COVERAGE_YEARS = 5;

/** The first day of the oldest calendar year of the window. @param {string} today YYYY-MM-DD @param {number} [years] */
export const coverageStart = (today, years = COVERAGE_YEARS) => `${Number(today.slice(0, 4)) - years + 1}-01-01`;

/**
 * @param {object[]} records
 * @param {{ today: string, years?: number }} options
 * @returns {{
 *   years: number[], rows: Array<{ kind: string, counts: Record<number, number>, total: number, first: string | null, last: string | null }>,
 *   total: number, first: string | null, last: string | null,
 * }}
 */
export function summarizeCoverage(records, { today, years = COVERAGE_YEARS }) {
  const lastYear = Number(today.slice(0, 4));
  const yearList = Array.from({ length: years }, (_, i) => lastYear - years + 1 + i);
  const start = coverageStart(today, years);
  const end = `${lastYear}-12-31`;

  const inWindow = records.filter((r) => r.status === 'approved' && REPORT_KIND_ORDER.includes(r.kind) && r.record_date && r.record_date >= start && r.record_date <= end);

  const rows = REPORT_KIND_ORDER.map((kind) => {
    const mine = inWindow.filter((r) => r.kind === kind);
    const dates = mine.map((r) => r.record_date).sort();
    return {
      kind,
      counts: Object.fromEntries(yearList.map((year) => [year, mine.filter((r) => r.record_date.startsWith(String(year))).length])),
      total: mine.length,
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
    };
  });

  const dates = inWindow.map((r) => r.record_date).sort();
  return { years: yearList, rows, total: inWindow.length, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
}

/** The coverage as plain text for an AI prompt: only what the records show, gaps named. */
export function coverageForPrompt(coverage, lang) {
  if (coverage.total === 0) return 'No approved records in this period.';
  const language = lang === 'es' ? 'es' : 'en';
  const present = coverage.rows.filter((row) => row.total > 0);
  const lines = present.map((row) => {
    const byYear = coverage.years.filter((year) => row.counts[year] > 0).map((year) => `${year}: ${row.counts[year]}`).join(', ');
    return `- ${KIND_META[row.kind].plural[language]}: ${row.total} ${row.total === 1 ? 'record' : 'records'} (${byYear}); first ${row.first}; last ${row.last}`;
  });
  const empty = coverage.rows.filter((row) => row.total === 0).map((row) => KIND_META[row.kind].plural[language]);
  return [...lines, ...(empty.length > 0 ? [`No records in: ${empty.join(', ')}`] : [])].join('\n');
}
