import { describe, it, expect } from 'vitest';
import { scoreCase, summarize } from './score.js';

const proposal = (over = {}) => ({ kind: 'activity', record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B2', product: 'Neem oil' }, missing: [], complete: true, ...over });
const expectOne = (over = {}) => ({ expect: [{ kind: 'activity', payload: { activity_type: 'spray', field: 'B2', product: 'neem' }, ...over }] });

describe('scoreCase', () => {
  it('passes when the produced record matches, ignoring case and accents for text', () => {
    expect(scoreCase(expectOne(), { proposals: [proposal()] })).toEqual({ pass: true, failures: [] });
    const accent = { expect: [{ kind: 'harvest', payload: { crop: 'lechuga romana' } }] };
    expect(scoreCase(accent, { proposals: [{ kind: 'harvest', record_date: null, payload: { crop: 'Lechuga Romána' }, missing: [], complete: true }] }).pass).toBe(true);
  });

  it('requires select fields to match exactly and numbers to be equal', () => {
    expect(scoreCase(expectOne(), { proposals: [proposal({ payload: { activity_type: 'other', field: 'B2', product: 'neem' } })] }).pass).toBe(false);
    const num = { expect: [{ kind: 'purchase', payload: { quantity: 3 } }] };
    const made = (q) => ({ proposals: [{ kind: 'purchase', record_date: null, payload: { quantity: q }, missing: [], complete: true }] });
    expect(scoreCase(num, made(3)).pass).toBe(true);
    expect(scoreCase(num, made('3')).pass).toBe(false);
    expect(scoreCase(num, made(4)).pass).toBe(false);
  });

  it('checks dates, completeness and expected missing fields', () => {
    expect(scoreCase(expectOne({ record_date: '2026-10-11' }), { proposals: [proposal()] }).pass).toBe(true);
    expect(scoreCase(expectOne({ record_date: '2026-10-10' }), { proposals: [proposal()] }).failures[0]).toMatch(/record_date/);
    expect(scoreCase(expectOne({ complete: false }), { proposals: [proposal()] }).failures[0]).toMatch(/complete/);
    expect(scoreCase(expectOne({ missing: ['rate'] }), { proposals: [proposal()] }).failures[0]).toMatch(/missing "rate"/);
  });

  it('fails a missed record and an invented one', () => {
    expect(scoreCase(expectOne(), { proposals: [] }).failures).toEqual(['missing a activity record']);
    const extra = scoreCase(expectOne(), { proposals: [proposal(), proposal({ kind: 'note', payload: { text: 'x' } })] });
    expect(extra.pass).toBe(false);
    expect(extra.failures).toEqual(['unexpected extra note record']);
  });

  it('expects nothing at all when nothing is expected', () => {
    expect(scoreCase({ expect: [] }, { proposals: [] }).pass).toBe(true);
    expect(scoreCase({ expect: [] }, { proposals: [proposal()] }).pass).toBe(false);
  });

  it('matches each expected record to a different produced record', () => {
    const twice = { expect: [{ kind: 'note', payload: { text: 'a' } }, { kind: 'note', payload: { text: 'b' } }] };
    const note = (text) => ({ kind: 'note', record_date: null, payload: { text }, missing: [], complete: true });
    expect(scoreCase(twice, { proposals: [note('a and b')] }).pass).toBe(false);
    expect(scoreCase(twice, { proposals: [note('b'), note('a')] }).pass).toBe(true);
  });
});

describe('summarize', () => {
  it('counts passes', () => {
    expect(summarize([{ pass: true }, { pass: false }, { pass: true }])).toEqual({ total: 3, passed: 2 });
  });
});
