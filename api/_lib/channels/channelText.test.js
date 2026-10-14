import { describe, it, expect } from 'vitest';
import { CHANNEL_TEXT, channelText } from './channelText.js';

const shape = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) => (value && typeof value === 'object' ? shape(value, `${prefix}${key}.`) : [`${prefix}${key}:${typeof value}`])).sort();

describe('channel text', () => {
  it('has the same keys, with the same kinds of values, in English and Spanish', () => {
    expect(shape(CHANNEL_TEXT.es)).toEqual(shape(CHANNEL_TEXT.en));
  });

  it('has no empty strings', () => {
    for (const lang of ['en', 'es']) {
      const walk = (o, path) => Object.entries(o).forEach(([k, v]) => (typeof v === 'object' ? walk(v, `${path}.${k}`) : typeof v === 'string' && expect(v.trim(), `${lang}.${path}.${k}`).not.toBe('')));
      walk(CHANNEL_TEXT[lang], lang);
    }
  });

  it('falls back to English for an unknown language', () => {
    expect(channelText('fr')).toBe(CHANNEL_TEXT.en);
    expect(channelText('es')).toBe(CHANNEL_TEXT.es);
    expect(channelText(undefined)).toBe(CHANNEL_TEXT.en);
  });

  it('formats counts, in both languages', () => {
    expect(CHANNEL_TEXT.en.filedHeader(1)).toBe('Filed 1 record for review ✅');
    expect(CHANNEL_TEXT.en.filedHeader(3)).toBe('Filed 3 records for review ✅');
    expect(CHANNEL_TEXT.es.filedHeader(2)).toMatch(/2 registros/);
    expect(CHANNEL_TEXT.en.skipped(2)).toMatch(/2 items/);
  });

  it('never tells the person a secret or an internal id', () => {
    const everything = JSON.stringify([CHANNEL_TEXT.en.error, CHANNEL_TEXT.es.error, CHANNEL_TEXT.en.busy, CHANNEL_TEXT.es.busy]);
    expect(everything).not.toMatch(/token|stack|sql|error code/i);
  });
});
