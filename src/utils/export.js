import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { safeFileName } from './markdown/aiDocument.js';
import { BULLET_NUMBERING, DOCX_STYLES, markdownToDocx } from './markdown/docx.js';

const BODY_SIZE = 24;
const MUTED = '94A3B8';
/** A first line that only repeats the document's own title, e.g. "# Organic System Plan (OSP)". */
const PLAN_TITLE_LINE = /^\s*#\s+(?:organic system plan|plan de sistema org)[^\n]*(?:\n|$)/i;

/** Spanish or English text for a document, whichever the farmer is using. */
const wording = (isEs) => (es, en) => (isEs ? es : en);

const heading = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } });
const divider = () => new Paragraph({ border: { bottom: { color: 'AAAAAA', space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { after: 200 } });
const body = (text) => new Paragraph({ children: [new TextRun({ text: text || '—', size: BODY_SIZE })], spacing: { after: 100 } });
const labelVal = (label, value) => new Paragraph({
  children: [new TextRun({ text: `${label}: `, bold: true, size: BODY_SIZE }), new TextRun({ text: value || '—', size: BODY_SIZE })],
  spacing: { after: 80 },
});

function titleBlock(say) {
  return [
    new Paragraph({
      children: [new TextRun({ text: say('PLAN DE SISTEMA ORGÁNICO (OSP)', 'ORGANIC SYSTEM PLAN (OSP)'), bold: true, size: 40, color: '002D54' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: say('Programa Orgánico del Estado de California (CASOP)', 'California State Organic Program (CASOP)'), size: 26, color: '64748B' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ];
}

function declaration(say, title) {
  return [
    heading(title),
    body(say(
      'Certifico que la información proporcionada en este Plan de Sistema Orgánico es precisa y completa según mi mejor conocimiento. Entiendo que la tergiversación intencional puede resultar en denegación, suspensión o revocación de la certificación orgánica bajo 7 CFR Parte 205.',
      'I certify that the information provided in this Organic System Plan is accurate and complete to the best of my knowledge. I understand that willful misrepresentation may result in denial, suspension, or revocation of organic certification under 7 CFR Part 205.',
    )),
    new Paragraph({ spacing: { after: 600 } }),
    labelVal(say('Firma', 'Signature'), '___________________________________'),
    labelVal(say('Fecha', 'Date'), '___________________________________'),
  ];
}

/** The AI-written text of one section, as Word paragraphs; a dash where the farm wrote nothing. */
function sectionText(markdown, idPrefix, numbering) {
  const { children, numbering: lists } = markdownToDocx(markdown, { idPrefix, minHeading: 2, baseSize: BODY_SIZE });
  numbering.push(...lists);
  return children.length ? children : [new Paragraph({ children: [new TextRun({ text: '—', size: BODY_SIZE, color: MUTED })], spacing: { after: 100 } })];
}

function formSections(profile, say, numbering) {
  const text = (markdown, prefix) => sectionText(markdown, prefix, numbering);
  return [
    heading(say('1. INFORMACIÓN DE LA OPERACIÓN', '1. OPERATION INFORMATION')),
    labelVal(say('Nombre de la Operación', 'Operation Name'), profile.operationName),
    labelVal(say('Propietario / Operador', 'Owner / Operator'), profile.ownerName),
    labelVal(say('Dirección', 'Address'), [profile.address, profile.city, profile.county, 'CA', profile.zip].filter(Boolean).join(', ')),
    labelVal(say('Teléfono', 'Phone'), profile.phone),
    labelVal(say('Correo Electrónico', 'Email'), profile.email),
    labelVal(say('Tipo de Operación', 'Operation Type'), profile.operationType),
    labelVal(say('Cultivos / Productos', 'Crops / Products'), profile.crops),
    labelVal(say('Hectáreas', 'Acreage'), profile.acreage),
    labelVal(say('Ventas Orgánicas Brutas Est.', 'Est. Gross Organic Sales'), profile.grossSales ? `$${profile.grossSales}` : ''),
    labelVal(say('Camino de Registro', 'Registration Path'), profile.registrationPath),
    divider(),

    heading(say('2. TIERRA Y PERÍODO DE TRANSICIÓN', '2. LAND & TRANSITION PERIOD')),
    labelVal(say('Años libre de sustancias prohibidas', 'Years free of prohibited substances'), profile.landFreeYears),
    labelVal(say('Última sustancia prohibida usada', 'Last prohibited substance used'), profile.lastProhibitedSubstance),
    divider(),

    heading(say('3. PRÁCTICAS DE PRODUCCIÓN ORGÁNICA', '3. ORGANIC PRODUCTION PRACTICES')),
    ...text(profile.practices, 'practices'),
    divider(),

    heading(say('4. INSUMOS Y SUSTANCIAS', '4. INPUTS & SUBSTANCES')),
    ...text(profile.inputs, 'inputs'),
    divider(),

    heading(say('5. MONITOREO Y MANTENIMIENTO DE REGISTROS', '5. MONITORING & RECORDKEEPING')),
    ...text(profile.monitoring, 'monitoring'),
    body(say('Nota: Todos los registros deben mantenerse durante al menos 5 años.', 'Note: All records must be maintained for a minimum of 5 years.')),
    divider(),

    heading(say('6. BARRERAS FÍSICAS Y PREVENCIÓN DE CONTAMINACIÓN', '6. PHYSICAL BUFFERS & CONTAMINATION PREVENTION')),
    ...text(profile.buffers, 'buffers'),
    divider(),

    heading(say('7. AGENTE CERTIFICADOR', '7. CERTIFYING AGENT')),
    labelVal(say('Certificador Seleccionado', 'Selected Certifier'), profile.certifierName),
    labelVal(say('Contacto', 'Contact'), profile.certifierContact),
    divider(),

    ...declaration(say, say('8. DECLARACIÓN', '8. DECLARATION')),

    ...(profile.registrationNotes ? [divider(), heading(say('9. NOTAS ADICIONALES', '9. ADDITIONAL NOTES')), ...text(profile.registrationNotes, 'notes')] : []),
  ];
}

/**
 * The Word document for an Organic System Plan. When the AI has written the whole plan, that plan is the
 * body (it already holds every section); otherwise the document is built from the form fields.
 *
 * @param {Record<string, string>} profile the operation details and the text of each section
 * @param {'en' | 'es'} [lang]
 * @param {string} [generatedPlan] the plan the AI wrote, as markdown
 * @returns {Document}
 */
export function buildOSPDocument(profile, lang = 'en', generatedPlan = '') {
  const say = wording(lang === 'es');
  const numbering = [];
  const hasPlan = typeof generatedPlan === 'string' && generatedPlan.trim() !== '';
  const children = hasPlan
    ? [...titleBlock(say), ...sectionText(generatedPlan.replace(PLAN_TITLE_LINE, ''), 'plan', numbering), divider(), ...declaration(say, say('DECLARACIÓN', 'DECLARATION'))]
    : [...titleBlock(say), ...formSections(profile, say, numbering)];
  return new Document({
    creator: 'OrganicPath CA',
    title: say('Plan de Sistema Orgánico (OSP)', 'Organic System Plan (OSP)'),
    styles: DOCX_STYLES,
    numbering: { config: [BULLET_NUMBERING, ...numbering] },
    sections: [{ properties: {}, children }],
  });
}

/**
 * Builds the plan and offers it to the browser as a download.
 * @param {Record<string, string>} profile
 * @param {'en' | 'es'} [lang]
 * @param {string} [generatedPlan]
 * @returns {Promise<void>}
 */
export async function exportOSPtoWord(profile, lang = 'en', generatedPlan = '') {
  const blob = await Packer.toBlob(buildOSPDocument(profile, lang, generatedPlan));
  const filename = `OSP_${safeFileName(profile.operationName || 'operation').replace(/-/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`;
  saveAs(blob, filename);
}
