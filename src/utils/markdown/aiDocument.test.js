// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { Packer } from 'docx';

const saveAs = vi.fn();
vi.mock('file-saver', () => ({ saveAs }));
const { buildAiDocument, downloadAiDocx, safeFileName } = await import('./aiDocument.js');

const textOf = (xml) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
async function parts(doc) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const footers = Object.keys(zip.files).filter((name) => /word\/footer\d*\.xml$/.test(name));
  const read = (name) => zip.file(name)?.async('string') ?? '';
  return {
    body: await read('word/document.xml'),
    numbering: await read('word/numbering.xml'),
    styles: await read('word/styles.xml'),
    footer: (await Promise.all(footers.map((name) => zip.file(name).async('string')))).join(''),
  };
}
const paragraphCount = (xml) => (xml.match(/<w:p[ >]/g) ?? []).length;

/** The number format of the list that each list paragraph points at. */
function listFormats(documentXml, numberingXml) {
  const abstractFormat = new Map([...numberingXml.matchAll(/<w:abstractNum w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)].map((m) => [m[1], /<w:numFmt w:val="(\w+)"/.exec(m[0])?.[1]]));
  const numFormat = new Map([...numberingXml.matchAll(/<w:num w:numId="(\d+)"[^>]*>\s*<w:abstractNumId w:val="(\d+)"\/>/g)].map((m) => [m[1], abstractFormat.get(m[2])]));
  return [...documentXml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => numFormat.get(m[1]));
}

describe('buildAiDocument', () => {
  it('puts the title, the subtitle and the formatted text into the document', async () => {
    const { body } = await parts(buildAiDocument({ title: 'Soil Assessment', subtitle: 'Palo Verde Farm', markdown: '## Findings\n\n- **pH** is 6.5' }));
    const text = textOf(body);
    expect(text).toContain('Soil Assessment');
    expect(text).toContain('Palo Verde Farm');
    expect(text).toContain('Findings');
    expect(text).toContain('pH is 6.5');
    expect(text).not.toMatch(/[#*]/);
    expect(body).toContain('w:val="Title"');
  });

  it('says in the footer that this is a draft to review, with page numbers', async () => {
    const { footer } = await parts(buildAiDocument({ title: 'T', markdown: 'x' }));
    expect(textOf(footer)).toMatch(/AI-assisted draft/);
    expect(footer).toContain('PAGE');
  });

  it('writes the footer in Spanish when asked', async () => {
    const { footer } = await parts(buildAiDocument({ title: 'T', markdown: 'x', lang: 'es' }));
    expect(textOf(footer)).toMatch(/ayuda de IA/);
    expect(textOf(footer)).toMatch(/Revísalo antes de usarlo\./);
  });

  it('points each bullet at a bullet list and each number at a number list', async () => {
    const { body, numbering } = await parts(buildAiDocument({ title: 'T', markdown: '- a\n- b\n\n1. c' }));
    expect(listFormats(body, numbering)).toEqual(['bullet', 'bullet', 'decimal']);
  });

  it('copes with a missing subtitle and with empty text, adding nothing but the title', async () => {
    const { body } = await parts(buildAiDocument({ title: 'Only a title', markdown: '' }));
    expect(textOf(body)).toBe('Only a title');
    expect(paragraphCount(body)).toBe(1);
  });

  it('adds a subtitle line only when there is a subtitle, and a divider only when there is text', async () => {
    expect(paragraphCount((await parts(buildAiDocument({ title: 'T', subtitle: 'S', markdown: '' }))).body)).toBe(2);
    expect(paragraphCount((await parts(buildAiDocument({ title: 'T', markdown: 'one paragraph' }))).body)).toBe(3);
    expect(paragraphCount((await parts(buildAiDocument({ title: 'T', subtitle: 'S', markdown: 'one paragraph' }))).body)).toBe(4);
  });

  it('writes the footer in English for a language it does not know', async () => {
    const { footer } = await parts(buildAiDocument({ title: 'T', markdown: 'x', lang: 'fr' }));
    expect(textOf(footer)).toMatch(/AI-assisted draft/);
    expect(textOf(footer)).toMatch(/Page /);
  });

  it('writes the page numbers in Spanish when asked', async () => {
    const { footer } = await parts(buildAiDocument({ title: 'T', markdown: 'x', lang: 'es' }));
    expect(textOf(footer)).toMatch(/Página /);
  });

  it('carries the bullet lists and the heading styles that the text uses', async () => {
    const { numbering, styles } = await parts(buildAiDocument({ title: 'T', markdown: '## Head\n\n- a\n\n1. b' }));
    expect(numbering).toContain('w:numFmt w:val="bullet"');
    expect(numbering).toContain('w:numFmt w:val="decimal"');
    expect(styles).toMatch(/w:styleId="Heading2"/);
    expect(styles).toContain('002D54');
  });

  it('keeps the numbering of two lists apart', async () => {
    const { body } = await parts(buildAiDocument({ title: 'T', markdown: '1. a\n2. b\n\ntext\n\n1. c' }));
    const references = [...body.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(new Set(references).size).toBe(2);
  });
});

describe('safeFileName', () => {
  it('makes a name that is safe on every system, keeping letters with accents', () => {
    expect(safeFileName('Soil Assessment: Finca Peña / 2026?')).toBe('Soil-Assessment-Finca-Peña-2026');
    expect(safeFileName('  ..\\..//evil  ')).toBe('evil');
    expect(safeFileName('')).toBe('document');
    expect(safeFileName(undefined)).toBe('document');
    expect(safeFileName('x'.repeat(200)).length).toBeLessThanOrEqual(80);
    expect(safeFileName(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79));
  });
});

describe('downloadAiDocx', () => {
  it('saves a Word file with the given name', async () => {
    saveAs.mockClear();
    await downloadAiDocx({ title: 'Report', markdown: '## A', filename: 'My Report 2026' });
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toBe('My-Report-2026.docx');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('names the file after the title when there is no filename', async () => {
    saveAs.mockClear();
    await downloadAiDocx({ title: 'Audit Trail', markdown: 'x' });
    expect(saveAs.mock.calls[0][1]).toBe('Audit-Trail.docx');
  });
});
