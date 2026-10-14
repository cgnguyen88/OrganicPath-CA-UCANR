import { describe, it, expect } from 'vitest';
import { formatMoney, formatNumber } from './format.js';

describe('formatMoney', () => {
  it('writes dollars with a thousands separator and cents', () => {
    expect(formatMoney(1234.5, 'en')).toBe('$1,234.50');
    expect(formatMoney(0, 'en')).toBe('$0.00');
    expect(formatMoney(0.3, 'en')).toBe('$0.30');
    expect(formatMoney(1234567.891, 'en')).toBe('$1,234,567.89');
  });

  it('writes them the same way in Spanish, for a farm in the United States', () => {
    expect(formatMoney(1234.5, 'es')).toBe('$1,234.50');
  });

  it('treats any other language as English', () => {
    expect(formatMoney(5, 'fr')).toBe('$5.00');
    expect(formatMoney(5, undefined)).toBe('$5.00');
  });
});

describe('formatNumber', () => {
  it('writes a number with a thousands separator and no needless decimals', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(12, 'en')).toBe('12');
    expect(formatNumber(0, 'en')).toBe('0');
  });

  it('keeps up to three decimals, the most an area is kept to', () => {
    expect(formatNumber(2.3456, 'en')).toBe('2.346');
    expect(formatNumber(0.001, 'en')).toBe('0.001');
  });

  it('writes the same way in Spanish for a farm in the United States, and treats any other language as English', () => {
    expect(formatNumber(1234.5, 'es')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'fr')).toBe('1,234.5');
    expect(formatNumber(1234.5, undefined)).toBe('1,234.5');
  });

  it('reads a number the database sent as text', () => {
    expect(formatNumber('2.500', 'en')).toBe('2.5');
  });

  it('writes nothing for what is not a number', () => {
    for (const bad of [null, undefined, '', 'abc', Number.NaN, Infinity]) expect(formatNumber(bad, 'en'), String(bad)).toBe('');
  });
});
