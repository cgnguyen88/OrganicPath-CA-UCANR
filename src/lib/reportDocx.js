import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, PageOrientation, Paragraph, ShadingType,
  Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import { saveAs } from 'file-saver';

/**
 * Writes a report model (see domain/records/report.js) as a Word file: landscape pages, tables whose
 * headings repeat on every page, and a place to sign. Every string in the model is already cleaned of
 * characters Word cannot store; this file only lays it out.
 */

// US Letter, sideways, with half-inch margins. Sizes are in twips (1/1440 inch).
const PAGE = { width: 12240, height: 15840 };
const MARGIN = 720;
const CONTENT_WIDTH = PAGE.height - 2 * MARGIN;
const MAX_WEIGHT_CHARS = 40;
const MIN_WEIGHT_CHARS = 7;

const FONT = 'Calibri';
const SIZE = { body: 18, small: 16, heading: 26, title: 36 };
const COLORS = { ink: '0F172A', muted: '64748B', headerFill: 'E2E8F0', line: 'CBD5E1' };
const THIN_LINE = { style: BorderStyle.SINGLE, size: 4, color: COLORS.line };
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

/** The language Word should check spelling in. */
const WORD_LANGUAGE = { en: 'en-US', es: 'es-ES' };
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Text runs for a string, turning each line break into a Word line break. */
function runs(text, options = {}) {
  return String(text).split('\n').map((line, index) => new TextRun({ text: line, font: FONT, size: SIZE.body, color: COLORS.ink, ...options, ...(index > 0 ? { break: 1 } : {}) }));
}

const paragraph = (text, options = {}, paragraphOptions = {}) => new Paragraph({ children: runs(text, options), ...paragraphOptions });

/** Roughly the width of one character of 9 pt text, and a cell's left and right padding plus its border. */
const CHAR_TWIPS = 105;
const CELL_PADDING = 200;
/** A word longer than this may be broken across lines, so it does not decide a column's width. */
const MAX_UNBREAKABLE_CHARS = 14;

const longestWord = (text) => Math.max(0, ...String(text).split(/\s+/).map((word) => word.length));
const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

/**
 * Column widths that add up to the page width exactly. Each column first gets room for its longest word
 * (so a date or a heading is never squeezed into a few characters a line); what is left over goes to the
 * columns that hold the most text.
 */
export function columnWidths(columns, rows) {
  const minimums = columns.map((column, index) => {
    const word = Math.min(MAX_UNBREAKABLE_CHARS, Math.max(longestWord(column.label), ...rows.map((row) => longestWord(row[index]))));
    return word * CHAR_TWIPS + CELL_PADDING;
  });
  const minimumTotal = sum(minimums);

  // Too many columns for the page even at their minimums: shrink them all in proportion.
  const widths = minimumTotal >= CONTENT_WIDTH
    ? minimums.map((width) => Math.floor((width * CONTENT_WIDTH) / minimumTotal))
    : (() => {
        const weights = columns.map((column, index) => Math.min(MAX_WEIGHT_CHARS, Math.max(MIN_WEIGHT_CHARS, column.label.length, ...rows.map((row) => String(row[index]).length))));
        const spare = CONTENT_WIDTH - minimumTotal;
        return minimums.map((width, index) => width + Math.floor((spare * weights[index]) / sum(weights)));
      })();

  // Rounding leaves a few twips over; give them to the first column so the table is exactly page wide.
  return widths.map((width, index) => (index === 0 ? width + (CONTENT_WIDTH - sum(widths)) : width));
}

function cell(text, width, { header = false, bold = false, borders } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    ...(header ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS.headerFill } } : {}),
    ...(borders ? { borders } : {}),
    children: [paragraph(text, { bold: header || bold, size: header ? SIZE.small : SIZE.body })],
  });
}

function dataTable(columns, rows) {
  const widths = columnWidths(columns, rows);
  const headerRow = new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c, i) => cell(c.label, widths[i], { header: true })) });
  const bodyRows = rows.map((row) => new TableRow({ cantSplit: true, children: row.map((value, i) => cell(value, widths[i])) }));
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { top: THIN_LINE, bottom: THIN_LINE, left: THIN_LINE, right: THIN_LINE, insideHorizontal: THIN_LINE, insideVertical: THIN_LINE },
    rows: [headerRow, ...bodyRows],
  });
}

function headerTable(header) {
  const labelWidth = 2600;
  return new Table({
    width: { size: labelWidth + 6000, type: WidthType.DXA },
    columnWidths: [labelWidth, 6000],
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: header.map(({ label, value }) => new TableRow({ children: [cell(label, labelWidth, { bold: true, borders: NO_BORDERS }), cell(value, 6000, { borders: NO_BORDERS })] })),
  });
}

function summaryTable(report) {
  const { text } = report;
  const columns = [{ label: text.summary }, { label: text.header.records }];
  const rows = report.sections.map((section) => [section.title, text.count(section.count)]);
  const widths = [5000, 2200];
  return new Table({
    width: { size: widths[0] + widths[1], type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { top: THIN_LINE, bottom: THIN_LINE, left: THIN_LINE, right: THIN_LINE, insideHorizontal: THIN_LINE, insideVertical: THIN_LINE },
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c, i) => cell(c.label, widths[i], { header: true })) }),
      ...rows.map((row) => new TableRow({ children: row.map((value, i) => cell(value, widths[i])) })),
    ],
  });
}

const SIGNATURE_GAP = 300;
const SIGNATURE_DATE_WIDTH = 3400;

/** Two long lines (prepared by, signature) and a short one (date), with gaps between, across the page width. */
function signatureWidths() {
  const line = (CONTENT_WIDTH - 2 * SIGNATURE_GAP - SIGNATURE_DATE_WIDTH) / 2;
  return [line, SIGNATURE_GAP, line, SIGNATURE_GAP, SIGNATURE_DATE_WIDTH];
}

/** "Prepared by / Signature / Date": blank lines for the operator to fill in. */
function signatureBlock(text) {
  const widths = signatureWidths();
  const labels = [text.signature.preparedBy, '', text.signature.signature, '', text.signature.date];
  const line = { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.ink } };
  const blank = (width, index) => new TableCell({ width: { size: width, type: WidthType.DXA }, borders: index % 2 === 0 ? line : NO_BORDERS, children: [paragraph('', {}, { spacing: { before: 400 } })] });
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({ cantSplit: true, children: widths.map(blank) }),
      new TableRow({ cantSplit: true, children: widths.map((width, index) => cell(labels[index], width, { borders: NO_BORDERS })) }),
    ],
  });
}

const spacer = (after = 120) => new Paragraph({ spacing: { after }, children: [] });

function footer(text) {
  const small = { size: SIZE.small, color: COLORS.muted };
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          ...runs(`${text.footer}   `, small),
          new TextRun({ children: [`${text.page} `, PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], font: FONT, ...small }),
        ],
      }),
    ],
  });
}

/**
 * @param {ReturnType<import('../domain/records/report.js').buildReport>} report
 * @returns {Document}
 */
export function buildReportDocument(report) {
  const { text } = report;

  const body = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 160 }, children: runs(report.title, { bold: true, size: SIZE.title }) }),
    headerTable(report.header),
    spacer(200),
  ];

  if (report.sections.length === 0) {
    body.push(paragraph(text.empty, { italics: true, color: COLORS.muted }));
  } else {
    body.push(summaryTable(report), spacer(240));
  }

  for (const section of report.sections) {
    body.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 240, after: 100 }, children: runs(`${section.title} — ${text.count(section.count)}`, { bold: true, size: SIZE.heading }) }),
      dataTable(section.columns, section.rows),
    );
  }

  if (report.truncated) body.push(spacer(120), paragraph(text.truncated, { italics: true, color: COLORS.muted }));
  body.push(spacer(400), signatureBlock(text));

  return new Document({
    creator: 'OrganicPath CA',
    title: report.title,
    styles: { default: { document: { run: { font: FONT, size: SIZE.body, language: { value: WORD_LANGUAGE[report.lang] ?? WORD_LANGUAGE.en } } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE, width: PAGE.width, height: PAGE.height }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
      footers: { default: footer(text) },
      children: body,
    }],
  });
}

/** Builds the Word file and hands it to the browser to save. */
export async function downloadReportDocx(report, fileName) {
  const blob = await Packer.toBlob(buildReportDocument(report));
  saveAs(new Blob([blob], { type: MIME_DOCX }), fileName);
}
