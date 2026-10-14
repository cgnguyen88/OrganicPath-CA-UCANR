/**
 * Reading a number a person typed. Plain decimals only: `Number()` alone would turn '0x1F', '1e3' or '0b11' into
 * numbers the person never meant.
 *
 *   * A comma is the decimal point ("12,5" is 12.5), for Spanish keyboards.
 *   * Except that groups of three digits after a comma are thousands ("1,000" is 1000, "12,345.5" is 12345.5),
 *     which is how the app itself writes a number, so what it shows can be typed back in unchanged.
 */

const DECIMAL = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
const THOUSANDS_GROUPED = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/;

/** @param {string} text @returns {number} NaN when it is not a plain number */
export function parseDecimalText(text) {
  const trimmed = text.trim();
  if (THOUSANDS_GROUPED.test(trimmed)) return Number(trimmed.replace(/,/g, ''));
  return DECIMAL.test(trimmed) ? Number(trimmed.replace(',', '.')) : Number.NaN;
}
