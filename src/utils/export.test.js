// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { Packer } from 'docx';

const saveAs = vi.fn();
vi.mock('file-saver', () => ({ saveAs }));
const { buildOSPDocument, exportOSPtoWord } = await import('./export.js');

const profile = {
  operationName: 'Palo Verde Farm', ownerName: 'Ana Reyes', address: '12 Farm Rd', city: 'Woodland', county: 'Yolo', zip: '95695', phone: '555-0100', email: 'ana@example.org',
  operationType: 'crop', crops: 'tomatoes', acreage: '12', grossSales: '40000', registrationPath: 'certified', landFreeYears: '3', lastProhibitedSubstance: 'none',
  practices: '## Soil\n\n**Compost** every spring:\n\n- Rotate beds\n- Cover crop in winter', inputs: '| Input | Source |\n|---|---|\n| Kelp meal | Sea Co |',
  monitoring: 'Records are kept in the Farm Records app.', buffers: '- 25 ft hedgerow', certifierName: 'CCOF', certifierContact: 'ccof.org', registrationNotes: '',
};

const unescapeXml = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textOf = (xml) => unescapeXml([...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''));
async function zipOf(doc) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  return { xml: await zip.file('word/document.xml').async('string'), numbering: await zip.file('word/numbering.xml').async('string') };
}
const xmlOf = async (doc) => (await zipOf(doc)).xml;

describe('buildOSPDocument from the form fields', () => {
  it('writes the numbered sections with the farm’s details', async () => {
    const text = textOf(await xmlOf(buildOSPDocument(profile, 'en')));
    for (const heading of ['ORGANIC SYSTEM PLAN (OSP)', '1. OPERATION INFORMATION', '3. ORGANIC PRODUCTION PRACTICES', '4. INPUTS & SUBSTANCES', '7. CERTIFYING AGENT', '8. DECLARATION']) expect(text).toContain(heading);
    expect(text).toContain('Palo Verde Farm');
    expect(text).toContain('Woodland, Yolo, CA, 95695');
    expect(text).toContain('$40000');
  });

  it('lays the AI text in the sections out as headings, lists and a table, without markdown marks', async () => {
    const xml = await xmlOf(buildOSPDocument(profile, 'en'));
    const text = textOf(xml);
    expect(text).toContain('Compost every spring:');
    expect(text).not.toMatch(/\*\*|\|---|## /);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toMatch(/<w:numPr>/);
    expect(xml).toContain('w:val="Heading2"');
  });

  it('shows a dash for a section the farm left empty', async () => {
    const text = textOf(await xmlOf(buildOSPDocument({ ...profile, practices: '' }, 'en')));
    expect(text).toContain('—');
  });

  it('is written in Spanish when asked', async () => {
    const text = textOf(await xmlOf(buildOSPDocument(profile, 'es')));
    expect(text).toContain('PLAN DE SISTEMA ORGÁNICO (OSP)');
    expect(text).toContain('8. DECLARACIÓN');
  });
});

describe('buildOSPDocument around a plan the AI wrote', () => {
  const plan = '## 1. Operation Information\n\n**Operation name:** Palo Verde Farm\n\nOwner: [NEEDS OPERATOR INPUT: legal name]\n\n## 2. Soil Fertility\n\n- Compost each spring';

  it('uses the plan as the body, not as one more form section, so nothing appears twice', async () => {
    const xml = await xmlOf(buildOSPDocument(profile, 'en', plan));
    const text = textOf(xml);
    expect(text).toContain('1. Operation Information');
    expect(text).toContain('2. Soil Fertility');
    expect(text).not.toContain('3. ORGANIC PRODUCTION PRACTICES');
    expect(text).not.toContain('Owner / Operator');
    expect(text).not.toMatch(/\*\*|## /);
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>/);
  });

  it('still ends with the declaration and the signature lines', async () => {
    const text = textOf(await xmlOf(buildOSPDocument(profile, 'en', plan)));
    expect(text).toContain('DECLARATION');
    expect(text).toContain('I certify that the information provided');
    expect(text).toContain('Signature');
    expect(text).toContain('Date');
  });

  it('falls back to the form fields when the plan is empty or blank', async () => {
    for (const blank of ['', '   \n', undefined]) {
      const text = textOf(await xmlOf(buildOSPDocument(profile, 'en', blank)));
      expect(text).toContain('3. ORGANIC PRODUCTION PRACTICES');
    }
  });
});

describe('exportOSPtoWord', () => {
  it('saves a .docx named for the operation and the date', async () => {
    saveAs.mockClear();
    await exportOSPtoWord(profile, 'en', '## Plan\n\ntext');
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = saveAs.mock.calls[0];
    expect(name).toMatch(/^OSP_Palo_Verde_Farm_\d{4}-\d{2}-\d{2}\.docx$/);
    expect(blob.size).toBeGreaterThan(1000);
  });
});

describe('buildOSPDocument: details', () => {
  it('writes the monitoring and buffer sections, with the five-year note, in both languages', async () => {
    const en = textOf(await xmlOf(buildOSPDocument(profile, 'en')));
    expect(en).toContain('Records are kept in the Farm Records app.');
    expect(en).toContain('25 ft hedgerow');
    expect(en).toContain('Note: All records must be maintained for a minimum of 5 years.');
    const es = textOf(await xmlOf(buildOSPDocument(profile, 'es')));
    expect(es).toContain('Nota: Todos los registros deben mantenerse durante al menos 5 años.');
  });

  it('adds the additional notes only when there are some', async () => {
    expect(textOf(await xmlOf(buildOSPDocument(profile, 'en')))).not.toContain('9. ADDITIONAL NOTES');
    const withNotes = textOf(await xmlOf(buildOSPDocument({ ...profile, registrationNotes: 'Bring the map.' }, 'en')));
    expect(withNotes).toContain('9. ADDITIONAL NOTES');
    expect(withNotes).toContain('Bring the map.');
  });

  it('keeps the numbered lists of different sections apart', async () => {
    const { xml, numbering } = await zipOf(buildOSPDocument({ ...profile, practices: '1. a\n2. b', inputs: '1. c\n2. d' }, 'en'));
    const lists = new Set([...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(lists.size).toBe(3); // the buffers bullet list, and one numbered list for each of the two sections
    expect(numbering.match(/w:numFmt w:val="decimal"/g).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the plan’s numbered lists, and puts its top heading below the section headings', async () => {
    const { xml, numbering } = await zipOf(buildOSPDocument(profile, 'en', '# Top\n\n1. a\n2. b'));
    expect(numbering).toContain('w:numFmt w:val="decimal"');
    const top = xml.split('</w:p>').find((p) => textOf(p) === 'Top');
    expect(top).toContain('w:val="Heading2"');
  });

  it('names a file for an operation with no name', async () => {
    saveAs.mockClear();
    await exportOSPtoWord({ ...profile, operationName: '' }, 'en');
    expect(saveAs.mock.calls[0][1]).toMatch(/^OSP_operation_\d{4}-\d{2}-\d{2}\.docx$/);
  });

  it('does not repeat the plan’s own title under the document title', async () => {
    const withTitle = textOf(await xmlOf(buildOSPDocument(profile, 'en', '# Organic System Plan (OSP)\n\n## 1. Operation\n\ntext')));
    expect(withTitle.match(/ORGANIC SYSTEM PLAN \(OSP\)/gi)).toHaveLength(1);
    expect(withTitle).toContain('1. Operation');
    const spanish = textOf(await xmlOf(buildOSPDocument(profile, 'es', '# Plan de Sistema Orgánico\n\n## 1. Operación')));
    expect(spanish.match(/PLAN DE SISTEMA ORGÁNICO \(OSP\)/gi)).toHaveLength(1);
    expect(spanish).not.toContain('Plan de Sistema Orgánico1. Operación');
    expect(spanish).toContain('1. Operación');
  });

  it('keeps a heading that only mentions the plan', async () => {
    const text = textOf(await xmlOf(buildOSPDocument(profile, 'en', '# Summary of the Organic System Plan\n\nx')));
    expect(text).toContain('Summary of the Organic System Plan');
  });

  it('names the file safely for any operation name', async () => {
    saveAs.mockClear();
    await exportOSPtoWord({ ...profile, operationName: '../Palo Verde/Farm: "North"' }, 'en', '## Plan');
    const name = saveAs.mock.calls[0][1];
    expect(name).toMatch(/^OSP_[A-Za-z0-9_]+_\d{4}-\d{2}-\d{2}\.docx$/);
    expect(name).not.toMatch(/[/\\:"]/);
  });
});

