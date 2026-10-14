const fold = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Does the produced value satisfy the expected one? Numbers: equal. Strings: "contains". */
function valueMatches(expected, actual) {
  if (actual === undefined || actual === null) return false;
  if (typeof expected === 'number') return typeof actual === 'number' && Math.abs(actual - expected) < 1e-9;
  return fold(actual).includes(fold(expected));
}

/** Select fields must match exactly; free text may contain the expected words. */
const EXACT_KEYS = new Set(['activity_type', 'omri_status', 'organic_status', 'method', 'category']);

function proposalProblems(expected, actual) {
  const problems = [];
  if (expected.record_date !== undefined && actual.record_date !== expected.record_date) {
    problems.push(`record_date: expected ${expected.record_date}, got ${actual.record_date}`);
  }
  if (expected.complete !== undefined && actual.complete !== expected.complete) {
    problems.push(`complete: expected ${expected.complete}, got ${actual.complete}`);
  }
  for (const key of expected.missing ?? []) {
    if (!actual.missing.includes(key)) problems.push(`should be missing "${key}"`);
  }
  for (const [key, want] of Object.entries(expected.payload ?? {})) {
    const got = actual.payload[key];
    const ok = EXACT_KEYS.has(key) ? got === want : valueMatches(want, got);
    if (!ok) problems.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  return problems;
}

/**
 * Compare an extraction result with a golden case. Every expected record must be matched by a
 * different produced record of the same kind, and nothing extra may be produced (an invented
 * record is worse than a missed one for an audit trail).
 *
 * @param {{ expect: Array<object> }} testCase
 * @param {{ proposals: Array<{ kind: string, record_date: string | null, payload: object, missing: string[], complete: boolean }> }} result
 * @returns {{ pass: boolean, failures: string[] }}
 */
export function scoreCase(testCase, result) {
  const failures = [];
  const unused = [...result.proposals];

  for (const expected of testCase.expect) {
    const candidates = unused.map((p, index) => ({ p, index })).filter(({ p }) => p.kind === expected.kind);
    if (candidates.length === 0) {
      failures.push(`missing a ${expected.kind} record`);
      continue;
    }
    // Take the candidate with the fewest problems.
    const scored = candidates.map((c) => ({ ...c, problems: proposalProblems(expected, c.p) })).sort((a, b) => a.problems.length - b.problems.length);
    const best = scored[0];
    unused.splice(best.index, 1);
    failures.push(...best.problems.map((problem) => `${expected.kind}: ${problem}`));
  }

  for (const extra of unused) failures.push(`unexpected extra ${extra.kind} record`);
  return { pass: failures.length === 0, failures };
}

/** @param {Array<{ pass: boolean }>} scores */
export const summarize = (scores) => ({ total: scores.length, passed: scores.filter((s) => s.pass).length });
