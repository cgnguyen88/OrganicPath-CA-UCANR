import { describe, it, expect } from 'vitest';
import { parseDecimalText } from './numbers.js';

describe('parseDecimalText', () => {
  it.each([['12', 12], ['12.5', 12.5], ['.5', 0.5], ['0', 0], ['  7 ', 7], ['007', 7], ['1000000', 1_000_000]])('reads %j as %d', (text, expected) => {
    expect(parseDecimalText(text)).toBe(expected);
  });

  it.each([['12,5', 12.5], [',5', 0.5], ['1,5', 1.5], ['1,25', 1.25], ['0,500', 0.5], ['1,0000', 1]])('reads a comma as the decimal point in %j (Spanish keyboards)', (text, expected) => {
    expect(parseDecimalText(text)).toBe(expected);
  });

  it.each([['1,000', 1000], ['1,500', 1500], ['12,345', 12345], ['999,999', 999_999], ['1,000,000', 1_000_000], ['12,345.5', 12_345.5], ['1,000.25', 1000.25]])(
    'reads %j as %d: groups of three after a comma are thousands, the way the app writes numbers',
    (text, expected) => {
      expect(parseDecimalText(text)).toBe(expected);
    },
  );

  it.each(['', '   ', 'abc', '1e3', '0x10', '0b11', '1.2.3', '1,2,3', '--5', '-5', '+5', '1 000', '1,00,000', '1,0000,000', '12,34.5.6', '0,500,000', 'Infinity', 'NaN', '1_000'])(
    'gives NaN for %j, which is not a plain number',
    (text) => {
      expect(parseDecimalText(text)).toBeNaN();
    },
  );
});
