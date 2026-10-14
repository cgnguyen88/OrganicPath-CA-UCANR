import { describe, it, expect } from 'vitest';
import { cleanText, neutralizeFormula, csvCell, toCsv } from './csv.js';

describe('cleanText', () => {
  it('turns null and undefined into an empty string and other values into text', () => {
    expect(cleanText(null)).toBe('');
    expect(cleanText(undefined)).toBe('');
    expect(cleanText(12.5)).toBe('12.5');
  });

  it('removes control characters that are not allowed in XML or that confuse spreadsheets', () => {
    expect(cleanText('a\u0000b\u0008c\u000bd\u000ce\u001ff\u007fg')).toBe('abcdefg');
  });

  it('keeps tabs and line breaks, and writes every line break as \\n', () => {
    expect(cleanText('one\r\ntwo\rthree\nfour\tfive')).toBe('one\ntwo\nthree\nfour\tfive');
  });

  it('removes characters that are not allowed in XML and so would make Word refuse the file', () => {
    expect(cleanText('a\uFFFEb\uFFFFc')).toBe('abc');
  });

  it('removes lone surrogate halves, which are not valid text, but keeps real emoji and other astral characters', () => {
    expect(cleanText('a\uD800b')).toBe('ab');
    expect(cleanText('a\uDC00b')).toBe('ab');
    expect(cleanText('x\uD83D')).toBe('x');
    expect(cleanText('😀 𝒜 𠀀')).toBe('😀 𝒜 𠀀');
  });

  it('removes the characters that reverse the direction of text, which can disguise what a cell says', () => {
    expect(cleanText('ab\u202Ecd\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069')).toBe('abcd');
  });

  it('never throws, whatever was stored: an object is written as JSON, and what cannot be written is empty', () => {
    expect(cleanText({ toString: 1 })).toBe('{"toString":1}');
    expect(cleanText([1, 'a'])).toBe('[1,"a"]');
    const loop = {}; loop.self = loop;
    expect(cleanText(loop)).toBe('');
    expect(cleanText(Symbol('s'))).toBe('Symbol(s)');
    expect(cleanText(true)).toBe('true');
    expect(cleanText(10n)).toBe('10');
  });

  it('keeps accents and other non-English text', () => {
    expect(cleanText('Aplicación de cobre · ñandú · 2 °C')).toBe('Aplicación de cobre · ñandú · 2 °C');
  });
});

describe('neutralizeFormula', () => {
  it.each(['=1+1', '+1', '-1+2', '@SUM(A1)', '\tcmd', '=HYPERLINK("http://evil.example","x")'])('defuses %j so a spreadsheet shows it as text', (text) => {
    expect(neutralizeFormula(text)).toBe(`'${text}`);
  });

  it.each(['\n=1+1', ' =1+1', '  +1', '\u00a0=1+1', '\u200b=1+1', '\u200f@x', '\ufeff=1+1', '\u2028-1', '\u0085=1+1', '\u2060=1+1'])(
    'defuses %j: a formula hidden behind blank or invisible characters is still a formula',
    (text) => {
      expect(neutralizeFormula(text)).toBe(`'${text}`);
    },
  );

  it.each(['Compost', '2026-05-01', '12.5', '', 'a=b', 'Sprayed -5 gal', ' leading space', '\nplain', 'x =1'])('leaves %j alone', (text) => {
    expect(neutralizeFormula(text)).toBe(text);
  });
});

describe('csvCell', () => {
  it('leaves plain text unquoted', () => {
    expect(csvCell('Compost')).toBe('Compost');
  });

  it('quotes text with a comma, a quote or a line break, and doubles inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('defuses a formula, and then quotes it if it needs quotes', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('never lets a control character through', () => {
    expect(csvCell('a\u0000b')).toBe('ab');
  });

  it('cleans before it looks for a formula, so a control character cannot hide one', () => {
    expect(csvCell('\u0001=1+1')).toBe("'=1+1");
    expect(csvCell('\u0000\u0008+1')).toBe("'+1");
  });

  it('defuses a formula that follows a carriage return', () => {
    expect(csvCell('\r=1+1')).toBe('"\'\n=1+1"');
  });

  it('does not throw on an unexpected value', () => {
    expect(csvCell({ toString: 1 })).toBe('"{""toString"":1}"');
  });

  it('writes numbers as they are, including zero', () => {
    expect(csvCell(0)).toBe('0');
    expect(csvCell(3.25)).toBe('3.25');
  });

  it('leaves a real negative number as a number (only text can be a formula)', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('-3')).toBe("'-3");
  });
});

describe('toCsv', () => {
  it('writes rows with Windows line endings and a byte-order mark so Excel reads accents correctly', () => {
    const out = toCsv([['Fecha', 'Producto'], ['2026-05-01', 'Cobre']]);
    expect(out).toBe('﻿Fecha,Producto\r\n2026-05-01,Cobre\r\n');
  });

  it('can leave out the byte-order mark', () => {
    expect(toCsv([['a']], { bom: false })).toBe('a\r\n');
  });

  it('writes empty cells for missing values so every row keeps its shape', () => {
    expect(toCsv([['a', undefined, null, 'd']], { bom: false })).toBe('a,,,d\r\n');
  });

  it('writes only the header for no data rows', () => {
    expect(toCsv([['a', 'b']], { bom: false })).toBe('a,b\r\n');
  });

  it('does not change the rows it is given', () => {
    const rows = Object.freeze([Object.freeze(['=x'])]);
    expect(() => toCsv(rows)).not.toThrow();
    expect(rows[0][0]).toBe('=x');
  });
});
