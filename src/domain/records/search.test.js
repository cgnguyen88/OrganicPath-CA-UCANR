import { describe, it, expect } from 'vitest';
import { matchesSearch, costSummary } from './search.js';

const purchase = (payload = {}, extra = {}) => ({ id: 'p1', kind: 'purchase', status: 'approved', record_date: '2026-08-14', payload: { supplier: 'Sea Coast Supply', product: 'Kelp meal', category: 'fertilizer', omri_status: 'listed', quantity: 50, unit: 'lb', total_cost: 82.5, invoice_number: 'INV-2291', notes: 'Delivered to the barn', ...payload }, ...extra });

describe('matchesSearch', () => {
  it('matches everything for an empty search', () => {
    expect(matchesSearch(purchase(), '', 'en')).toBe(true);
    expect(matchesSearch(purchase(), '   ', 'en')).toBe(true);
    expect(matchesSearch(purchase(), undefined, 'en')).toBe(true);
  });

  it('finds a record by its supplier, product, invoice number or notes', () => {
    for (const query of ['sea coast', 'KELP', 'inv-2291', 'barn']) expect(matchesSearch(purchase(), query, 'en'), query).toBe(true);
  });

  it('finds a record by its date, or part of it', () => {
    expect(matchesSearch(purchase(), '2026-08', 'en')).toBe(true);
    expect(matchesSearch(purchase(), '2026-08-14', 'en')).toBe(true);
    expect(matchesSearch(purchase(), '2025', 'en')).toBe(false);
  });

  it('finds a record by a number it holds', () => {
    expect(matchesSearch(purchase(), '82.5', 'en')).toBe(true);
    expect(matchesSearch(purchase({ total_cost: 0 }), '0', 'en')).toBe(true);
  });

  it('finds a record by the name of a choice, in the language of the screen', () => {
    expect(matchesSearch(purchase(), 'fertilizer', 'en')).toBe(true);
    expect(matchesSearch(purchase(), 'fertilizante', 'es')).toBe(true);
    expect(matchesSearch(purchase(), 'omri listed', 'en')).toBe(true);
    expect(matchesSearch(purchase({ omri_status: 'not_listed' }), 'not listed', 'en')).toBe(true);
    expect(matchesSearch(purchase({ omri_status: 'not_listed' }), 'omri listed', 'en')).toBe(false);
  });

  it('needs every word of the search, in any order', () => {
    expect(matchesSearch(purchase(), 'kelp coast', 'en')).toBe(true);
    expect(matchesSearch(purchase(), 'coast kelp', 'en')).toBe(true);
    expect(matchesSearch(purchase(), 'kelp tractor', 'en')).toBe(false);
  });

  it('ignores capital letters and accents', () => {
    expect(matchesSearch(purchase({ product: 'Cal Agrícola' }), 'AGRICOLA', 'es')).toBe(true);
    expect(matchesSearch(purchase({ product: 'Cal Agricola' }), 'agrícola', 'es')).toBe(true);
  });

  it('finds a record by its type, which helps in a view that mixes kinds', () => {
    expect(matchesSearch(purchase(), 'purchase', 'en')).toBe(true);
    expect(matchesSearch(purchase(), 'compra', 'es')).toBe(true);
    expect(matchesSearch({ kind: 'harvest', payload: {} }, 'harvest', 'en')).toBe(true);
    expect(matchesSearch({ kind: 'harvest', payload: {} }, 'cosecha', 'es')).toBe(true);
    expect(matchesSearch(purchase(), 'harvest', 'en')).toBe(false);
  });

  it('does not make empty or structured values searchable as words', () => {
    const record = { kind: 'note', record_date: null, payload: { text: 'hello', a: null, b: undefined, c: { x: 1 }, d: [1, 2] } };
    for (const query of ['null', 'undefined', 'object', '[object', '1,2']) expect(matchesSearch(record, query, 'en'), query).toBe(false);
    expect(matchesSearch(record, 'hello', 'en')).toBe(true);
  });

  it('does not match on the names of fields, only on what they hold', () => {
    expect(matchesSearch(purchase(), 'total_cost', 'en')).toBe(false);
    expect(matchesSearch(purchase(), 'supplier', 'en')).toBe(false);
  });

  it('does not find something that is not there', () => {
    expect(matchesSearch(purchase(), 'tractor', 'en')).toBe(false);
  });

  it('copes with a record with no date and no details, and with odd values', () => {
    expect(matchesSearch({ kind: 'note', payload: {} }, 'x', 'en')).toBe(false);
    expect(matchesSearch({ kind: 'note', payload: { text: 'hello' }, record_date: null }, 'hello', 'en')).toBe(true);
    expect(matchesSearch({ kind: 'note', payload: { text: { nested: 'object' }, extra: null, flag: true } }, 'true', 'en')).toBe(true);
    expect(matchesSearch({ kind: 'note' }, 'a', 'en')).toBe(false);
  });

  it('does not treat what is typed as a pattern', () => {
    expect(matchesSearch(purchase(), '.*', 'en')).toBe(false);
    expect(matchesSearch(purchase({ notes: 'cost (approx.)' }), '(approx.)', 'en')).toBe(true);
    expect(matchesSearch(purchase(), '[', 'en')).toBe(false);
  });
});

describe('costSummary', () => {
  it('adds up the cost of the records that have one, and counts those that do not', () => {
    const summary = costSummary([purchase({ total_cost: 82.5 }), purchase({ total_cost: 17.5 }), purchase({ total_cost: undefined }), purchase({ total_cost: undefined })]);
    expect(summary).toEqual({ total: 100, counted: 2, missing: 2 });
  });

  it('counts a cost of zero as a cost', () => {
    expect(costSummary([purchase({ total_cost: 0 })])).toEqual({ total: 0, counted: 1, missing: 0 });
  });

  it('adds up amounts that are not exact in binary', () => {
    expect(costSummary([purchase({ total_cost: 1.15 })]).total).toBe(1.15);
    expect(costSummary([purchase({ total_cost: 19.99 }), purchase({ total_cost: 4.35 }), purchase({ total_cost: 0.07 })]).total).toBe(24.41);
  });

  it('does not add up floating-point dust', () => {
    expect(costSummary([purchase({ total_cost: 0.1 }), purchase({ total_cost: 0.2 })]).total).toBe(0.3);
    expect(costSummary(Array.from({ length: 10 }, () => purchase({ total_cost: 0.1 }))).total).toBe(1);
  });

  it('ignores a cost that is not a plain non-negative number', () => {
    const summary = costSummary([purchase({ total_cost: '12' }), purchase({ total_cost: -5 }), purchase({ total_cost: NaN }), purchase({ total_cost: Infinity }), purchase({ total_cost: null }), purchase({ total_cost: 10 })]);
    expect(summary).toEqual({ total: 10, counted: 1, missing: 5 });
  });

  it('is zero for no records', () => {
    expect(costSummary([])).toEqual({ total: 0, counted: 0, missing: 0 });
  });
});
