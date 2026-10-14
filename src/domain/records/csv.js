/**
 * Safe CSV writing for farm records. Record text can come from anyone with a Telegram link or a
 * photographed receipt, so every cell is treated as untrusted:
 *   - control characters are removed (they break Word/XML files and confuse spreadsheets);
 *   - a cell that starts like a spreadsheet formula is defused so Excel/Sheets show it as text.
 */

// Characters that must never reach an export: control characters except tab and line feed, the two
// "non-characters" XML forbids (U+FFFE, U+FFFF) and the controls that reverse the direction of text.
// Carriage returns are normalised before this runs.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF\u202A-\u202E\u2066-\u2069]/g;
const ANY_SURROGATE = /[\uD800-\uDFFF]/;
/**
 * What spreadsheets treat as the start of a formula (OWASP "CSV injection"): a leading tab, or one of
 * = + - @ after any blank or invisible characters (a carriage return, a space, a zero-width space...).
 * (`\s` already covers non-breaking spaces, line and paragraph separators and the byte-order mark.)
 */
const FORMULA_START = /^\t|^[\s\u0085\u200B-\u200F\u2060]*[=+\-@]/;
const NEEDS_QUOTES = /[",\n\r]/;
const BYTE_ORDER_MARK = '\uFEFF';

/** Any stored value as text. Never throws: an object becomes JSON, and what cannot be written becomes empty. */
function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** Text with its lone surrogate halves removed (a real emoji is a pair and stays). */
function withoutLoneSurrogates(text) {
  if (!ANY_SURROGATE.test(text)) return text;
  let kept = '';
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 0xd800 || code > 0xdfff) kept += character;
  }
  return kept;
}

/** @param {unknown} value @returns {string} text that is safe to put in any export format */
export function cleanText(value) {
  return withoutLoneSurrogates(asText(value).replace(/\r\n?/g, '\n').replace(UNSAFE_CHARS, ''));
}

/** @param {string} text */
export function neutralizeFormula(text) {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** One CSV cell: cleaned, defused if it looks like a formula, quoted if it needs to be. */
export function csvCell(value) {
  const text = typeof value === 'number' ? String(value) : neutralizeFormula(cleanText(value));
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * @param {ReadonlyArray<ReadonlyArray<unknown>>} rows
 * @param {{ bom?: boolean }} [options] `bom` (default true) adds the byte-order mark Excel needs to read accents.
 * @returns {string}
 */
export function toCsv(rows, { bom = true } = {}) {
  const body = rows.map((row) => `${row.map(csvCell).join(',')}\r\n`).join('');
  return bom ? `${BYTE_ORDER_MARK}${body}` : body;
}
