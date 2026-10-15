// @vitest-environment node
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Document, Packer } from 'docx';
import { markdownToDocx, DOCX_STYLES, BULLET_NUMBERING } from './docx.js';

async function render(markdown, options) {
  const { children, numbering } = markdownToDocx(markdown, options);
  const doc = new Document({
    styles: DOCX_STYLES,
    numbering: { config: [BULLET_NUMBERING, ...numbering] },
    sections: [{ children: children.length ? children : [] }],
  });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  return {
    xml: await zip.file('word/document.xml').async('string'),
    numbering: await zip.file('word/numbering.xml').async('string'),
    result: { children, numbering },
  };
}

const textOf = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

describe('markdownToDocx', () => {
  it('gives nothing for empty or non-text input', () => {
    for (const v of ['', '  ', null, undefined, 4]) {
      const { children, numbering } = markdownToDocx(v);
      expect(children).toEqual([]);
      expect(numbering).toEqual([]);
    }
  });

  it('writes the words without any markdown marks', async () => {
    const { xml } = await render('## Soil plan\n\nUse **compost** and *cover crops* with `lime`.\n\n- first\n- second');
    const text = textOf(xml);
    expect(text).toContain('Soil plan');
    expect(text).toContain('Use compost and cover crops with lime.');
    expect(text).not.toMatch(/[#*`]/);
  });

  it('makes headings with Word heading styles', async () => {
    const { xml } = await render('## Two\n\n### Three\n\n#### Four');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('w:val="Heading3"');
    expect(xml).toContain('w:val="Heading4"');
  });

  it('can keep headings below the document title level', async () => {
    const { xml } = await render('# One\n\n## Two', { minHeading: 2 });
    expect(xml).not.toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="Heading2"');
  });

  it('writes bold and italic as formatting, not marks', async () => {
    const { xml } = await render('**bold** and *italic*');
    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).toMatch(/<w:i\/>/);
  });

  it('writes bullets as a real Word list, with nested levels', async () => {
    const { xml, numbering } = await render('- a\n  - a1\n- b');
    expect(xml).toMatch(/<w:numPr>/);
    expect(xml).toMatch(/<w:ilvl w:val="1"\/>/);
    expect(numbering).toContain('w:numFmt w:val="bullet"');
  });

  it('writes a numbered list as a real Word list that starts where the markdown does', async () => {
    const { xml, numbering, result } = await render('1. one\n2. two\n\ntext\n\n3. three');
    expect(result.numbering).toHaveLength(2);
    expect(numbering).toContain('w:numFmt w:val="decimal"');
    expect(numbering).toMatch(/<w:start w:val="3"\/>/);
    expect(textOf(xml)).toContain('one');
  });

  it('gives each markdown text its own list numbering, so two texts in one document do not run together', () => {
    const a = markdownToDocx('1. a', { idPrefix: 'a' }).numbering.map((n) => n.reference);
    const b = markdownToDocx('1. b', { idPrefix: 'b' }).numbering.map((n) => n.reference);
    expect(a).not.toEqual(b);
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it('writes a table with a repeating header row, shaded, with the cell text', async () => {
    const { xml } = await render('| Item | Qty |\n|:--|--:|\n| Kelp | **4** |\n| Neem | 2 |');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblHeader');
    expect(xml.match(/<w:tr>|<w:tr /g)).toHaveLength(3);
    expect(xml).toContain('w:val="right"');
    expect(xml).toMatch(/w:fill="[0-9A-Fa-f]{6}"/);
    expect(textOf(xml)).toBe('ItemQtyKelp4Neem2');
  });

  it('writes a link as a clickable link to a safe address only', async () => {
    const { xml } = await render('see [CDFA](https://www.cdfa.ca.gov/) and [bad](javascript:alert(1))');
    expect(xml).toContain('<w:hyperlink');
    expect(xml).not.toContain('javascript');
    expect(textOf(xml)).toContain('CDFA');
    expect(textOf(xml)).toContain('bad');
  });

  it('keeps the [NEEDS OPERATOR INPUT: …] marker visible and highlighted', async () => {
    const { xml } = await render('Name: [NEEDS OPERATOR INPUT: legal name]');
    expect(textOf(xml)).toContain('[NEEDS OPERATOR INPUT: legal name]');
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>/);
  });

  it('writes a quote, a rule and a code block', async () => {
    const { xml } = await render('> Always confirm.\n\n---\n\n```\nx = 1\n```');
    expect(textOf(xml)).toContain('Always confirm.');
    expect(textOf(xml)).toContain('x = 1');
    expect(xml).toContain('<w:pBdr>');
    expect(xml).toContain('Consolas');
  });

  it('keeps line breaks inside a paragraph', async () => {
    const { xml } = await render('one\ntwo');
    expect(xml).toContain('<w:br/>');
  });

  it('never puts markup characters from the text into the XML as elements', async () => {
    const { xml } = await render('<script>alert(1)</script> & <b>x</b>');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
  });

  it('copes with a deep or odd document without throwing', async () => {
    const odd = ['- '.repeat(40), '1. a\n   - b\n      1. c\n         - d\n            - e', '| a |\n|---|', '>'.repeat(30) + ' x'];
    for (const text of odd) await expect(render(text)).resolves.toBeTruthy();
  });
});

/** What each list paragraph in the document points at: the number format of its list. */
function listFormats(documentXml, numberingXml) {
  const abstractFormat = new Map([...numberingXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)].map((m) => [m[1], /<w:numFmt w:val="(\w+)"/.exec(m[0])?.[1]]));
  const numFormat = new Map([...numberingXml.matchAll(/<w:num w:numId="(\d+)"[^>]*>\s*<w:abstractNumId w:val="(\d+)"\/>/g)].map((m) => [m[1], abstractFormat.get(m[2])]));
  return [...documentXml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => numFormat.get(m[1]));
}

describe('markdownToDocx: details Word depends on', () => {
  it('points every bullet at the bullet list and every number at a number list', async () => {
    const { xml, numbering } = await render('- a\n- b\n\n1. c\n2. d');
    expect(listFormats(xml, numbering)).toEqual(['bullet', 'bullet', 'decimal', 'decimal']);
  });

  it('gives each numbered list its own numbering, so a later list does not carry on from an earlier one', async () => {
    const { xml, result } = await render('1. a\n\ntext\n\n1. b');
    const references = result.numbering.map((n) => n.reference);
    expect(new Set(references).size).toBe(2);
    expect(new Set([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1])).size).toBe(2);
  });

  it('never goes deeper than the levels a list defines', async () => {
    const deep = Array.from({ length: 8 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n');
    const { xml } = await render(deep);
    const levels = [...xml.matchAll(/<w:ilvl w:val="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(Math.max(...levels)).toBe(3);
    expect(textOf(xml)).toContain('level 7');
  });

  it('never asks for a heading level Word does not have', () => {
    const { children } = markdownToDocx('# x', { minHeading: 9 });
    expect(children).toHaveLength(1);
    expect(JSON.stringify(children[0])).toContain('Heading6');
  });

  it('repeats the table header row on every page, shades and bolds it, and leaves the body plain', async () => {
    const { xml } = await render('| H |\n|---|\n| c |');
    expect(xml).toMatch(/<w:tblHeader\/>/);
    const [, header, body] = xml.split(/<w:tr>|<w:tr /);
    expect(header).toMatch(/<w:b\/>/);
    expect(header).toMatch(/w:fill="DDE6EF"/);
    expect(body).not.toMatch(/<w:b\/>/);
    expect(body).not.toMatch(/w:fill="DDE6EF"/);
  });

  it('puts a paragraph after a table, so two tables do not run together', async () => {
    const { xml } = await render('| a |\n|---|\n| 1 |');
    expect(xml).toMatch(/<\/w:tbl><w:p[ >]/);
  });

  it('shares the table width equally between the columns', async () => {
    const { xml } = await render('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(xml.match(/<w:gridCol w:w="4680"\/>/g)).toHaveLength(2);
  });

  it('writes inline code in a code font', async () => {
    const { xml } = await render('use `lime`');
    expect(xml).toContain('Consolas');
  });

  it('writes each line of a code block as its own paragraph in a code font', async () => {
    const { xml } = await render('```\nline one\nline two\n```');
    const paragraphs = xml.split('</w:p>').filter((p) => p.includes('Consolas'));
    expect(paragraphs).toHaveLength(2);
    expect(textOf(paragraphs[0])).toBe('line one');
    expect(textOf(paragraphs[1])).toBe('line two');
  });

  it('draws a quote with a coloured bar and in italics, and a rule as a line', async () => {
    const quote = (await render('> Always confirm.')).xml;
    expect(quote).toMatch(/<w:left /);
    expect(quote).toMatch(/<w:i\/>/);
    const rule = (await render('---')).xml;
    expect(rule).toMatch(/<w:bottom /);
  });

  it('uses the font size it is given, and the document’s own otherwise', async () => {
    expect((await render('x', { baseSize: 24 })).xml).toMatch(/<w:sz w:val="24"\/>/);
    expect((await render('x')).xml).not.toMatch(/<w:sz /);
  });

  it('indents a paragraph that belongs to a list item', async () => {
    const { xml } = await render('- a\n\n  more text');
    const paragraph = xml.split('</w:p>').find((p) => textOf(p) === 'more text');
    expect(paragraph).toMatch(/<w:ind /);
  });

  it('writes a checklist with boxes in place of bullets', async () => {
    const { xml } = await render('- [ ] Check logs\n- [x] Sign form\n- plain');
    expect(textOf(xml)).toContain('\u2610 Check logs');
    expect(textOf(xml)).toContain('\u2611 Sign form');
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBe(1);
  });

  it('writes a link to a web address in the text as a link', async () => {
    const { xml } = await render('see https://omri.org/search');
    expect(xml).toContain('<w:hyperlink');
  });

  it('indents a checklist item like a list item', async () => {
    const { xml } = await render('- [ ] Check logs');
    const paragraph = xml.split('</w:p>').find((p) => textOf(p).includes('Check logs'));
    expect(paragraph).toMatch(/<w:ind /);
  });
});

