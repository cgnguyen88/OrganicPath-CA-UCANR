import { describe, it, expect } from 'vitest';
import { fieldLabel } from './labels.js';

describe('fieldLabel', () => {
  it('names a field in the requested language', () => {
    expect(fieldLabel('activity', 'rate', 'en', 'Date')).toMatch(/rate/i);
    expect(fieldLabel('activity', 'rate', 'es', 'Fecha')).not.toBe(fieldLabel('activity', 'rate', 'en', 'Date'));
  });

  it('uses the supplied label for the date', () => {
    expect(fieldLabel('seed', 'record_date', 'es', 'Fecha')).toBe('Fecha');
  });

  it('falls back to the key for an unknown field or kind', () => {
    expect(fieldLabel('activity', 'mystery', 'en', 'Date')).toBe('mystery');
    expect(fieldLabel('nope', 'rate', 'en', 'Date')).toBe('rate');
  });
});
