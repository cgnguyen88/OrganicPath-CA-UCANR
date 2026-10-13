import { describe, it, expect } from 'vitest';
import { RECORDS_TEXT } from './text.js';

const shape = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) => (value && typeof value === 'object' ? shape(value, `${prefix}${key}.`) : [`${prefix}${key}:${typeof value}`])).sort();

describe('records text', () => {
  it('has exactly the same keys, with the same kinds of values, in English and Spanish', () => {
    expect(shape(RECORDS_TEXT.es)).toEqual(shape(RECORDS_TEXT.en));
  });

  it('has no empty strings', () => {
    for (const lang of ['en', 'es']) {
      const walk = (o, path) => Object.entries(o).forEach(([k, v]) => (typeof v === 'object' ? walk(v, `${path}.${k}`) : typeof v === 'string' && expect(v.trim(), `${lang}.${path}.${k}`).not.toBe('')));
      walk(RECORDS_TEXT[lang], lang);
    }
  });

  it('formats counts and labels in both languages', () => {
    expect(RECORDS_TEXT.en.overview.needsReview(1)).toBe('1 record is waiting for review');
    expect(RECORDS_TEXT.en.overview.needsReview(5)).toBe('5 records are waiting for review');
    expect(RECORDS_TEXT.es.overview.needsReview(5)).toMatch(/5 registros/);
    expect(RECORDS_TEXT.en.log.add('Harvest')).toBe('Add harvest');
  });
});
