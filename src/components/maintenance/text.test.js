import { describe, it, expect } from 'vitest';
import { MAINTENANCE_TEXT } from './text.js';

const shape = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) => (value && typeof value === 'object' ? shape(value, `${prefix}${key}.`) : [`${prefix}${key}:${typeof value}`])).sort();

describe('maintenance text', () => {
  it('has the same keys, with the same kinds of values, in English and Spanish', () => {
    expect(shape(MAINTENANCE_TEXT.es)).toEqual(shape(MAINTENANCE_TEXT.en));
  });

  it('has no empty strings', () => {
    for (const lang of ['en', 'es']) {
      const walk = (o, path) => Object.entries(o).forEach(([k, v]) => (typeof v === 'object' ? walk(v, `${path}.${k}`) : typeof v === 'string' && expect(v.trim(), `${lang}.${path}.${k}`).not.toBe('')));
      walk(MAINTENANCE_TEXT[lang], lang);
    }
  });

  it('counts materials in both languages', () => {
    expect(MAINTENANCE_TEXT.en.verification.fromRecords(1)).toBe('1 material from your Farm Records.');
    expect(MAINTENANCE_TEXT.en.verification.fromRecords(3)).toBe('3 materials from your Farm Records.');
    expect(MAINTENANCE_TEXT.es.verification.fromRecords(1)).toBe('1 material de los Registros de tu Finca.');
    expect(MAINTENANCE_TEXT.es.verification.fromRecords(3)).toMatch(/^3 materiales/);
  });

  it('speaks to the reader as tú, and says “certificadora”, like the rest of the Spanish text', () => {
    const all = JSON.stringify(MAINTENANCE_TEXT.es);
    expect(all).not.toMatch(/\b(usted|ustedes|Inténtelo|Elija|Descargue|Revíselo)\b/);
    expect(all).not.toMatch(/ertificador\b(?!a)/);
  });
});
