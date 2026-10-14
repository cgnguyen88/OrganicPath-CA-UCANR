import { describe, it, expect } from 'vitest';
import { RECORDS_TEXT } from './text.js';
import { REPORT_TEXT } from '../../domain/records/report.js';

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

  it('names statuses and sources the same way in reports as everywhere else in the app', () => {
    for (const lang of ['en', 'es']) {
      expect(REPORT_TEXT[lang].status, `${lang} status`).toEqual(RECORDS_TEXT[lang].status);
      expect(REPORT_TEXT[lang].source, `${lang} source`).toEqual(RECORDS_TEXT[lang].source);
    }
  });

  it('speaks to the reader the same way (tú) throughout the Spanish text', () => {
    const strings = [];
    // Some strings are functions of a count, some of a name or a date: try each way, keep what they write.
    const written = (fn) => [2, 1, 'Cosecha', '2026-01-01'].flatMap((arg) => {
      try {
        return [fn(arg, arg)];
      } catch {
        return [];
      }
    });
    const walk = (o) => Object.values(o).forEach((v) => (typeof v === 'object' ? walk(v) : typeof v === 'function' ? strings.push(...written(v)) : strings.push(v)));
    walk(RECORDS_TEXT.es);
    walk(REPORT_TEXT.es);
    const formal = strings.filter((text) => typeof text === 'string' && /\b(usted|ustedes|sus registros|su certificador|Inténtelo|Elija|Descargue|prepare un|Revíselos?|Reduzca)\b/.test(text));
    expect(formal).toEqual([]);
  });

  it('calls the person who certifies the farm “certificadora”, as the rest of the Spanish text does', () => {
    const all = JSON.stringify(RECORDS_TEXT.es) + JSON.stringify(REPORT_TEXT.es);
    expect(all).not.toMatch(/ertificador\b(?!a)/);
  });
});
