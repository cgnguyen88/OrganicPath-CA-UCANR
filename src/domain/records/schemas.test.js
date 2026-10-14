import { describe, it, expect } from 'vitest';
import { evaluateRecord, recordFingerprint, summarizeRecord, isValidIsoDate, DATE_MIN, DATE_MAX } from './schemas.js';

const ok = (kind, input) => evaluateRecord(kind, input);

describe('evaluateRecord: normalization', () => {
  it('trims text, drops empty values, and coerces numeric strings', () => {
    const r = ok('harvest', { record_date: '2026-10-01', payload: { crop: '  Lettuce ', field: 'B4', quantity: '12.5', unit: 'lb', notes: '' } });
    expect(r.ok).toBe(true);
    expect(r.value.payload).toEqual({ crop: 'Lettuce', field: 'B4', quantity: 12.5, unit: 'lb' });
  });

  it('strips keys that are not part of the kind', () => {
    const r = ok('note', { record_date: '2026-10-01', payload: { text: 'hi', admin: true, __proto__x: 1 } });
    expect(Object.keys(r.value.payload)).toEqual(['text']);
  });

  it.each([
    ['a non-numeric number', { quantity: '12abc' }],
    ['a negative number', { quantity: -1 }],
    ['an absurdly large number', { quantity: 1e12 }],
    ['an unknown select value', { unit: 'x'.repeat(201) }],
  ])('flags %s as invalid', (_label, extra) => {
    const r = ok('harvest', { record_date: '2026-10-01', payload: { crop: 'a', field: 'b', quantity: 1, unit: 'lb', ...extra } });
    expect(r.ok).toBe(false);
    expect(Object.values(r.errors)).toContain('invalid');
  });

  it('rejects a select value that is not an option', () => {
    const r = ok('activity', { record_date: '2026-10-01', payload: { activity_type: 'explode', field: 'A' } });
    expect(r.ok).toBe(false);
    expect(r.errors.activity_type).toBe('invalid');
  });

  it('caps long text', () => {
    expect(ok('note', { record_date: '2026-10-01', payload: { text: 'x'.repeat(2001) } }).errors.text).toBe('invalid');
    expect(ok('note', { record_date: '2026-10-01', payload: { text: 'x'.repeat(2000) } }).ok).toBe(true);
  });

  it('reports an unknown kind', () => {
    expect(ok('bogus', { payload: {} })).toMatchObject({ ok: false, errors: { kind: 'unknown_kind' } });
  });

  it('treats a missing payload as empty', () => {
    expect(ok('note', { record_date: '2026-10-01' }).missing).toContain('text');
  });
});

describe('evaluateRecord: numbers are plain decimals', () => {
  const qty = (value) => evaluateRecord('harvest', { record_date: '2026-10-01', payload: { crop: 'a', field: 'b', quantity: value, unit: 'lb' } });


  it.each([['12', 12], ['12.5', 12.5], ['.5', 0.5], ['12,5', 12.5], [',5', 0.5], ['  7 ', 7], ['0', 0]])('accepts %j as %d (a comma works as a decimal point for Spanish keyboards)', (input, expected) => {
    expect(qty(input).value.payload.quantity).toBe(expected);
  });

  it.each(['0x1F', '0b11', '0o7', '1e3', '1_000', '+5', '-5', '5.', '1,2,3', '12abc', 'Infinity', 'NaN', '1 000'])('rejects %j instead of quietly turning it into some other number', (input) => {
    expect(qty(input).errors.quantity).toBe('invalid');
  });
});

describe('evaluateRecord: dates', () => {
  it.each(['2026-10-01', '2024-02-29'])('accepts %s', (d) => {
    expect(ok('note', { record_date: d, payload: { text: 'x' } }).ok).toBe(true);
  });

  it.each(['1900-01-01', '2100-12-31'])('accepts the edges of the supported range: %s', (d) => {
    expect(ok('note', { record_date: d, payload: { text: 'x' } }).ok).toBe(true);
  });

  it.each(['0000-01-01', '1899-12-31', '2101-01-01'])('rejects %s (outside 1900-2100; the database would refuse year 0 anyway)', (d) => {
    expect(ok('note', { record_date: d, payload: { text: 'x' } }).errors.record_date).toBe('invalid');
  });

  it.each(['2026-02-30', '10/01/2026', '2026-1-1', 'yesterday', 20261001])('rejects %j', (d) => {
    expect(ok('note', { record_date: d, payload: { text: 'x' } }).errors.record_date).toBe('invalid');
  });

  it('allows the date to be absent while drafting, but reports it as missing', () => {
    const r = ok('note', { payload: { text: 'x' } });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual(['record_date']);
    expect(r.complete).toBe(false);
  });
});

describe('evaluateRecord: completeness (drives the agent follow-up questions)', () => {
  it('lists every missing required field in form order, date first', () => {
    expect(ok('harvest', { payload: { crop: 'Lettuce' } }).missing).toEqual(['record_date', 'field', 'quantity', 'unit']);
  });

  it('asks for product, mix rate and target for a spray', () => {
    const r = ok('activity', { record_date: '2026-10-01', payload: { activity_type: 'spray', field: 'B4' } });
    expect(r.missing).toEqual(['product', 'rate', 'target']);
    expect(r.complete).toBe(false);
  });

  it('is complete once the spray details are provided', () => {
    const r = ok('activity', {
      record_date: '2026-10-01',
      payload: { activity_type: 'spray', field: 'B4', product: 'Bt', rate: '1 oz/gal', target: 'caterpillars' },
    });
    expect(r).toMatchObject({ ok: true, complete: true, missing: [] });
  });

  it('does not require spray fields for other activities', () => {
    expect(ok('activity', { record_date: '2026-10-01', payload: { activity_type: 'irrigation', field: 'B4' } }).complete).toBe(true);
  });

  it('never calls a record with validation errors complete', () => {
    const r = ok('harvest', { record_date: '2026-10-01', payload: { crop: 'a', field: 'b', quantity: 'lots', unit: 'lb' } });
    expect(r.complete).toBe(false);
  });
});

describe('recordFingerprint', () => {
  const base = { supplier: 'Acme Farm Supply', product: 'Compost', total_cost: 50, invoice_number: 'INV-1' };

  it('is stable and ignores case and punctuation', () => {
    const a = recordFingerprint('purchase', '2026-10-01', base);
    const b = recordFingerprint('purchase', '2026-10-01', { ...base, supplier: 'ACME farm-supply!', product: ' compost ' });
    expect(a).toBe(b);
  });

  it('changes when a key field changes', () => {
    const a = recordFingerprint('purchase', '2026-10-01', base);
    expect(recordFingerprint('purchase', '2026-10-02', base)).not.toBe(a);
    expect(recordFingerprint('purchase', '2026-10-01', { ...base, total_cost: 51 })).not.toBe(a);
    expect(recordFingerprint('harvest', '2026-10-01', base)).not.toBe(a);
  });

  it('ignores fields that are not identity (notes)', () => {
    expect(recordFingerprint('purchase', '2026-10-01', { ...base, notes: 'x' })).toBe(recordFingerprint('purchase', '2026-10-01', base));
  });

  it('returns null when there is nothing to identify the record by', () => {
    expect(recordFingerprint('purchase', null, {})).toBeNull();
  });
});

describe('summarizeRecord', () => {
  const s = (kind, payload, lang = 'en') => summarizeRecord({ kind, payload }, lang);

  it('builds a short readable title per kind', () => {
    expect(s('purchase', { product: 'Compost', supplier: 'Acme' })).toBe('Compost · Acme');
    expect(s('activity', { activity_type: 'spray', field: 'B4', product: 'Bt' })).toBe('Spray · B4 · Bt');
    expect(s('harvest', { crop: 'Lettuce', quantity: 12, unit: 'lb' })).toBe('Lettuce · 12 lb');
    expect(s('inventory', { item: 'Kelp', quantity: 3, unit: 'bags' })).toBe('Kelp · 3 bags');
    expect(s('seed', { crop: 'Lettuce', variety: 'Romaine' })).toBe('Lettuce Romaine');
  });

  it('localizes option labels', () => {
    expect(summarizeRecord({ kind: 'activity', payload: { activity_type: 'spray', field: 'B4' } }, 'es')).toMatch(/^Aplicación/);
  });

  it('truncates long notes and falls back to the kind label when empty', () => {
    expect(s('note', { text: 'x'.repeat(100) }).length).toBeLessThanOrEqual(61);
    expect(s('purchase', {})).toBe('Purchase');
    expect(s('purchase', {}, 'es')).toBe('Compra');
  });
});

describe('the dates a record may use', () => {
  it('has first and last dates that are themselves valid, and one day beyond each that is not', () => {
    expect(isValidIsoDate(DATE_MIN)).toBe(true);
    expect(isValidIsoDate(DATE_MAX)).toBe(true);
    expect(isValidIsoDate('1899-12-31')).toBe(false);
    expect(isValidIsoDate('2101-01-01')).toBe(false);
  });

  it('refuses text that is not a real date', () => {
    for (const bad of ['', '0026-05-01', '2026-13-01', '2026-02-30', '2026-5-1', 'tomorrow', null, undefined, 20260501]) expect(isValidIsoDate(bad), String(bad)).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });
});

