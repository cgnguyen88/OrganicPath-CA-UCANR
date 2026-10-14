import { describe, it, expect } from 'vitest';
import { GENERATORS_TEXT } from './text.js';

const shape = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) => (value && typeof value === 'object' ? shape(value, `${prefix}${key}.`) : [`${prefix}${key}:${typeof value}`])).sort();

describe('generators text', () => {
  it('has the same keys, with the same kinds of values, in English and Spanish', () => {
    expect(shape(GENERATORS_TEXT.es)).toEqual(shape(GENERATORS_TEXT.en));
  });

  it('has no empty strings', () => {
    for (const lang of ['en', 'es']) {
      const walk = (o, path) => Object.entries(o).forEach(([k, v]) => (typeof v === 'object' ? walk(v, `${path}.${k}`) : typeof v === 'string' && expect(v.trim(), `${lang}.${path}.${k}`).not.toBe('')));
      walk(GENERATORS_TEXT[lang], lang);
    }
  });

  it('counts in both languages, with the right singular and plural', () => {
    expect(GENERATORS_TEXT.en.records.attention(1)).toBe('1 needs OMRI verification');
    expect(GENERATORS_TEXT.en.records.attention(3)).toBe('3 need OMRI verification');
    expect(GENERATORS_TEXT.es.records.attention(1)).toBe('1 necesita verificación OMRI');
    expect(GENERATORS_TEXT.es.records.attention(2)).toBe('2 necesitan verificación OMRI');
    expect(GENERATORS_TEXT.en.records.applications(1, 2, '2026-01-01', '2026-02-01')).toBe('1 spray record and 2 amendment records, 2026-01-01 to 2026-02-01');
    expect(GENERATORS_TEXT.es.records.applications(1, 1, 'a', 'b')).toBe('1 registro de aplicación y 1 registro de enmienda, del a al b');
  });

  it('speaks to the reader as tú, and says “certificadora”', () => {
    const all = JSON.stringify(GENERATORS_TEXT.es) + Object.values(GENERATORS_TEXT.es.audit.systemDescription ? [GENERATORS_TEXT.es.audit.systemDescription(1, 'a', 'b', 1)] : []).join('');
    expect(all).not.toMatch(/\b(usted|ustedes|Inténtelo|Elija|Descargue|Revíselo|Consulte)\b/);
    expect(all).not.toMatch(/ertificador\b(?!a)/);
  });

  it('writes a plain factual description of the record system', () => {
    expect(GENERATORS_TEXT.en.audit.systemDescription(120, '2024-03-01', '2026-10-01', 6)).toContain('120 approved records across 6 record types, from 2024-03-01 to 2026-10-01');
    expect(GENERATORS_TEXT.es.audit.systemDescription(120, '2024-03-01', '2026-10-01', 6)).toContain('120 registros aprobados en 6 tipos de registro');
  });
});
