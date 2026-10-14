import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { Packer } from 'docx';
import { buildReport } from '../domain/records/report.js';

const saveAs = vi.fn();
vi.mock('file-saver', () => ({ saveAs: (...a) => saveAs(...a) }));

const { buildReportDocument, downloadReportDocx, columnWidths } = await import('./reportDocx.js');

let n = 0;
const rec = (kind, record_date, payload, extra = {}) =>
  ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, source: 'manual', reviewed_at: '2026-06-02T10:00:00Z', created_at: `2026-06-01T10:00:${String(n % 60).padStart(2, '0')}Z`, ...extra });
const spray = (date, payload = {}) => rec('activity', date, { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', ...payload });

const farm = { id: 'f1', name: 'Palo Verde Farm', farm_code: 'PV-1234' };
const make = (records, extra = {}) => buildReport({ records, farm, operation: { operationName: 'Palo Verde Organics', certifierName: 'CCOF' }, lang: 'en', generatedOn: '2026-10-14', ...extra });

/** Open the generated .docx and return the XML of its main document and footer. */
async function parts(report) {
  const buffer = await Packer.toBuffer(buildReportDocument(report));
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  const footerName = names.find((name) => /word\/footer\d*\.xml$/.test(name));
  return {
    buffer,
    document: await zip.file('word/document.xml').async('string'),
    footer: footerName ? await zip.file(footerName).async('string') : '',
    styles: await zip.file('word/styles.xml').async('string'),
    core: await zip.file('docProps/core.xml').async('string'),
  };
}

describe('buildReportDocument', () => {
  it('writes a real Word file', async () => {
    const { buffer } = await parts(make([spray('2026-07-01')]));
    expect(buffer.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(buffer[0], buffer[1])).toBe('PK');
  });

  it('puts the title, the operation details and each section with its records on the page', async () => {
    const { document } = await parts(make([spray('2026-07-01'), rec('harvest', '2026-08-01', { crop: 'Tomato', field: 'B2', quantity: 40, unit: 'lb' })]));
    for (const text of ['Organic Records Report', 'Palo Verde Organics', 'PV-1234', 'CCOF', 'Activities', 'Harvest Log', 'Neem oil', 'Aphids', 'Tomato', '40 lb', '2026-07-01', 'Approved records only']) {
      expect(document, text).toContain(text);
    }
  });

  it('lays the pages out sideways, so wide tables fit', async () => {
    const { document } = await parts(make([spray('2026-07-01')]));
    expect(document).toMatch(/w:orient="landscape"/);
  });

  it('repeats the column headings of a records table on every page and does not split its rows across pages', async () => {
    const { document } = await parts(make([spray('2026-07-01', { product: 'Neem oil' }), spray('2026-07-02')]));
    const table = document.split('<w:tbl>').find((t) => t.includes('Neem oil'));
    expect(table.match(/<w:tblHeader/g)).toHaveLength(1);
    expect(table.match(/<w:cantSplit/g)).toHaveLength(3); // the heading row and both records
  });

  it('shows a summary of how many records each section has', async () => {
    const { document } = await parts(make([spray('2026-07-01'), spray('2026-07-02')]));
    expect(document).toContain('Summary');
    expect(document).toContain('2 records');
  });

  it('keeps a line break inside a note', async () => {
    const { document } = await parts(make([spray('2026-07-01', { notes: 'first line\nsecond line' })]));
    expect(document).toContain('first line');
    expect(document).toContain('second line');
    expect(document).toMatch(/first line<\/w:t><w:br\/>|first line<\/w:t>[\s\S]*?<w:br\/>/);
  });

  it('writes accents and other non-English text correctly', async () => {
    const { document } = await parts(make([spray('2026-07-01', { notes: 'Aplicación en la mañana, 2 °C' })], { lang: 'es' }));
    expect(document).toContain('Informe de Registros Orgánicos');
    expect(document).toContain('Aplicación en la mañana, 2 °C');
    expect(document).toContain('Preparado por');
  });

  it('writes text that looks like markup as plain text', async () => {
    const { document } = await parts(make([spray('2026-07-01', { notes: '<script>alert(1)</script> & more' })]));
    expect(document).not.toContain('<script>');
    expect(document).toContain('&lt;script&gt;');
    expect(document).toContain('&amp; more');
  });

  it('never writes characters that are not allowed in a Word file', async () => {
    const { document } = await parts(make([spray('2026-07-01', { notes: 'bad\u0000text\u0008here' })]));
    // eslint-disable-next-line no-control-regex
    expect(document).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(document).toContain('badtexthere');
  });

  it('says so when the list was cut short', async () => {
    const { document } = await parts(make([spray('2026-07-01')], { truncated: true }));
    expect(document).toContain('cut short');
  });

  it('says so when there is nothing to show, and still produces a valid file', async () => {
    const { document, buffer } = await parts(make([]));
    expect(document).toContain('There are no records for this selection.');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('ends with lines to fill in: prepared by, signature and date', async () => {
    const { document } = await parts(make([spray('2026-07-01')]));
    for (const text of ['Prepared by', 'Signature', 'Date']) expect(document).toContain(text);
  });

  it('puts a footer with the note and the page numbers on every page', async () => {
    const { footer } = await parts(make([spray('2026-07-01')]));
    expect(footer).toContain('not a statement of compliance');
    expect(footer).toContain('PAGE');
    expect(footer).toContain('NUMPAGES');
  });

  it('gives every column room for its longest word, and the columns fill the page exactly', async () => {
    const everything = { activity_type: 'spray', field: 'B2', product: 'Neem oil', rate: '2 oz/gal', target: 'Aphids', area: 1, area_unit: 'acre', applicator: 'Ana Ruiz', equipment: 'Backpack sprayer', omri_status: 'listed', notes: 'Applied in the early morning.\nWind 3 mph from the west.' };
    const { document } = await parts(make([rec('activity', '2026-07-01', everything), rec('activity', '2026-07-02', everything)]));
    const widths = [...document.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    const tables = document.split('<w:tbl>').slice(1).map((t) => [...t.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1])));
    const wide = tables.reduce((a, b) => (b.length > a.length ? b : a), []);
    expect(widths.length).toBeGreaterThan(0);
    expect(wide).toHaveLength(12);
    expect(wide.reduce((a, b) => a + b, 0)).toBe(14400);
    // A full date, and the word "Approved" with a date under it, must not be squeezed into a few characters a line.
    expect(wide[0]).toBeGreaterThanOrEqual(1200);
    expect(wide.at(-1)).toBeGreaterThanOrEqual(1000);
    expect(Math.min(...wide)).toBeGreaterThanOrEqual(600);
  });

  it('squeezes a table whose columns all hold long words to fit the page, rather than running off it', async () => {
    const long = (c) => c.repeat(30);
    const { document } = await parts(make([rec('activity', '2026-07-01', {
      activity_type: 'spray', field: long('a'), product: long('b'), rate: long('c'), target: long('d'), area: 1, area_unit: 'acre',
      applicator: long('e'), equipment: long('f'), omri_status: 'listed', notes: long('g'),
    })]));
    const tables = document.split('<w:tbl>').slice(1).map((t) => [...t.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1])));
    const wide = tables.reduce((a, b) => (b.length > a.length ? b : a), []);
    expect(wide).toHaveLength(12);
    expect(wide.reduce((a, b) => a + b, 0)).toBe(14400);
    expect(Math.min(...wide)).toBeGreaterThan(500);
  });

  it('writes the page numbers in the language of the report', async () => {
    const english = await parts(make([spray('2026-07-01')]));
    expect(english.footer).toContain('Page');
    const spanish = await parts(make([spray('2026-07-01')], { lang: 'es' }));
    expect(spanish.footer).toContain('Página');
    expect(spanish.footer).not.toMatch(/>Page </);
  });

  it('marks the file as Spanish or English, so Word checks the spelling in the right language', async () => {
    expect((await parts(make([spray('2026-07-01')]))).styles).toMatch(/<w:lang w:val="en-US"/);
    expect((await parts(make([spray('2026-07-01')], { lang: 'es' }))).styles).toMatch(/<w:lang w:val="es-ES"/);
  });

  it('lays the signature lines across the whole page width', async () => {
    const { document } = await parts(make([spray('2026-07-01')]));
    const signature = document.split('<w:tbl>').find((t) => t.includes('Prepared by'));
    const widths = [...signature.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(5);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(14400);
  });

  it('writes nothing a Word file may not contain, whatever odd characters the records hold', async () => {
    const odd = 'a\uFFFEb\uFFFFc\uD800d\uDC00e\u0000f\u202Eg 😀';
    const { document, core } = await parts(make([spray('2026-07-01', { notes: odd, product: odd, field: odd })], { title: `Report ${odd}` }));
    // The characters XML 1.0 allows: this is the test a real XML parser applies, not the cleaner's own list.
    // eslint-disable-next-line no-control-regex
    const illegalXml = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
    expect(document).not.toMatch(illegalXml);
    expect(core).not.toMatch(illegalXml);
    expect(document).toContain('😀');
    expect(document).not.toContain('\u202E');
  });

  it('copes with a very large number of columns and a very long note', async () => {
    const everything = { activity_type: 'spray', field: 'B2', product: 'Neem', rate: '2', target: 'x', area: 1, area_unit: 'acre', applicator: 'A', equipment: 'E', omri_status: 'listed', notes: 'word '.repeat(300) };
    const { buffer } = await parts(make([rec('activity', '2026-07-01', everything)]));
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

describe('downloadReportDocx', () => {
  it('saves the file under the name it is given', async () => {
    saveAs.mockReset();
    await downloadReportDocx(make([spray('2026-07-01')]), 'organic-records_palo-verde-farm_2026-10-14.docx');
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toBe('organic-records_palo-verde-farm_2026-10-14.docx');
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toContain('wordprocessingml');
  });
});

describe('columnWidths', () => {
  const sum = (list) => list.reduce((a, b) => a + b, 0);

  it('always adds up to the page width', () => {
    const columns = [{ label: 'Date' }, { label: 'Notes' }];
    expect(sum(columnWidths(columns, [['2026-07-01', 'short']]))).toBe(14400);
    expect(sum(columnWidths(columns, []))).toBe(14400);
  });

  it('gives more room to the column that holds more text', () => {
    const [date, notes] = columnWidths([{ label: 'Date' }, { label: 'Notes' }], [['2026-07-01', 'a fairly long note about what was done in the field today']]);
    expect(notes).toBeGreaterThan(date);
  });

  it('never gives a column a negative or zero width, however many long-word columns share the page', () => {
    const word = 'x'.repeat(14);
    const columns = [...Array.from({ length: 19 }, (_, i) => ({ label: `C${i}` })), { label: 'N' }];
    const row = [...Array.from({ length: 19 }, () => word), 'ab '.repeat(40)];
    const widths = columnWidths(columns, [row]);
    expect(sum(widths)).toBe(14400);
    expect(Math.min(...widths)).toBeGreaterThan(150);
  });
});
