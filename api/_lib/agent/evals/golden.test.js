import { describe, it, expect } from 'vitest';
import { KIND_FIELDS, RECORD_KINDS } from '../../../../src/domain/records/kinds.js';
import { GOLDEN_CASES, EVAL_TODAY } from './golden.js';

describe('golden eval set', () => {
  it('has unique ids and both languages', () => {
    const ids = GOLDEN_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(GOLDEN_CASES.map((c) => c.lang))).toEqual(new Set(['en', 'es']));
  });

  it('covers every record kind', () => {
    const kinds = new Set(GOLDEN_CASES.flatMap((c) => c.expect.map((e) => e.kind)));
    expect([...kinds].sort()).toEqual([...RECORD_KINDS].sort());
  });

  it('includes a message with no record, a prompt-injection attempt and an incomplete record', () => {
    expect(GOLDEN_CASES.some((c) => c.expect.length === 0)).toBe(true);
    expect(GOLDEN_CASES.some((c) => /ignore all previous instructions/i.test(c.text))).toBe(true);
    expect(GOLDEN_CASES.some((c) => c.expect.some((e) => e.complete === false))).toBe(true);
  });

  it.each(GOLDEN_CASES.map((c) => [c.id, c]))('%s only expects fields that exist for its kind, with valid values', (_id, testCase) => {
    expect(testCase.text.trim()).not.toBe('');
    for (const expected of testCase.expect) {
      const fields = KIND_FIELDS[expected.kind];
      expect(fields, `unknown kind ${expected.kind}`).toBeTruthy();
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
      for (const [key, value] of Object.entries(expected.payload ?? {})) {
        expect(byKey[key], `${expected.kind} has no field ${key}`).toBeTruthy();
        if (byKey[key].type === 'select') expect(byKey[key].options.map((o) => o.value)).toContain(value);
        if (byKey[key].type === 'number') expect(typeof value).toBe('number');
      }
      for (const key of expected.missing ?? []) expect([...Object.keys(byKey), 'record_date'], `missing key ${key}`).toContain(key);
      if (expected.record_date) expect(expected.record_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('fixes "today" so relative dates have one right answer', () => {
    expect(EVAL_TODAY).toBe('2026-10-12');
    const yesterday = GOLDEN_CASES.find((c) => c.id === 'en-spray-complete');
    expect(yesterday.expect[0].record_date).toBe('2026-10-11');
  });
});
