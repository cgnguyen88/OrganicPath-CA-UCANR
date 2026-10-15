import {
  AlignmentType, BorderStyle, ExternalHyperlink, HeadingLevel, LevelFormat, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { parseMarkdown } from './parse.js';

/**
 * Markdown → Word. Headings use real Word heading styles, lists are real Word lists, tables are real
 * tables, so a farmer can edit the document in Word without any markdown marks left in it.
 * The caller puts `children` into a section and adds BULLET_NUMBERING and `numbering` to the
 * document's numbering config (and DOCX_STYLES to its styles).
 */

const FONT = 'Calibri';
const MONO = 'Consolas';
const NAVY = '002D54';
const TABLE_WIDTH = 9360; // US Letter with one-inch margins, in twentieths of a point
const MAX_LEVEL = 3;
const BULLET_REFERENCE = 'ai-bullets';
const EMPTY_BOX = '\u2610';
const CHECKED_BOX = '\u2611';
const BULLET_CHARACTERS = ['•', '◦', '▪', '–'];
const ORDERED_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL];
const HEADINGS = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const ALIGNMENTS = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

const levelIndent = (level) => ({ left: 720 + 360 * level, hanging: 360 });
const solid = (fill) => ({ type: ShadingType.CLEAR, fill, color: 'auto' });
const line = (color, size, space = 1) => ({ style: BorderStyle.SINGLE, size, color, space });
const gridLine = line('BFC8D2', 4);

export const BULLET_NUMBERING = {
  reference: BULLET_REFERENCE,
  levels: BULLET_CHARACTERS.map((text, level) => ({
    level, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: levelIndent(level) } },
  })),
};

const headingStyle = (id, name, size, color, before, after, outlineLevel) => ({
  id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
  run: { font: FONT, size, bold: true, color },
  paragraph: { spacing: { before, after }, keepNext: true, outlineLevel },
});

export const DOCX_STYLES = {
  default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
  paragraphStyles: [
    headingStyle('Title', 'Title', 40, NAVY, 0, 120, 0),
    headingStyle('Heading1', 'Heading 1', 32, NAVY, 320, 120, 0),
    headingStyle('Heading2', 'Heading 2', 28, NAVY, 280, 100, 1),
    headingStyle('Heading3', 'Heading 3', 24, NAVY, 220, 80, 2),
    headingStyle('Heading4', 'Heading 4', 22, '334155', 180, 60, 3),
    headingStyle('Heading5', 'Heading 5', 22, '475569', 160, 60, 4),
    headingStyle('Heading6', 'Heading 6', 22, '475569', 140, 60, 5),
  ],
};

function orderedNumbering(reference, level, start) {
  return {
    reference,
    levels: Array.from({ length: MAX_LEVEL + 1 }, (_, i) => ({
      level: i,
      format: ORDERED_FORMATS[i],
      text: `%${i + 1}.`,
      alignment: AlignmentType.LEFT,
      start: i === level ? start : 1,
      style: { paragraph: { indent: levelIndent(i) } },
    })),
  };
}

function makeRuns(baseSize) {
  const runs = (nodes, style = {}) => nodes.map((node) => {
    const base = { ...(baseSize && { size: baseSize }), ...style };
    switch (node.type) {
      case 'text':
        return new TextRun({ ...base, text: node.text });
      case 'break':
        return new TextRun({ ...base, break: 1 });
      case 'strong':
        return runs(node.children, { ...style, bold: true });
      case 'em':
        return runs(node.children, { ...style, italics: true });
      case 'code':
        return new TextRun({ ...base, text: node.text, font: MONO, shading: solid('EEF2F6') });
      case 'marker':
        return new TextRun({ ...base, text: `[NEEDS OPERATOR INPUT: ${node.text}]`, bold: true, highlight: 'yellow' });
      case 'link':
        return new ExternalHyperlink({ link: node.href, children: runs(node.children, { ...style, color: '0563C1', underline: {} }) });
      default:
        return [];
    }
  }).flat();
  return runs;
}

function convertTable(block, ctx) {
  const columns = block.header.length;
  const width = Math.floor(TABLE_WIDTH / columns);
  const borders = { top: gridLine, bottom: gridLine, left: gridLine, right: gridLine };
  const cell = (nodes, col, header) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: header ? solid('DDE6EF') : undefined,
    children: [new Paragraph({
      alignment: ALIGNMENTS[block.align[col]],
      spacing: { after: 0 },
      children: ctx.runs(nodes, header ? { bold: true, color: NAVY } : {}),
    })],
  });
  const table = new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: Array(columns).fill(width),
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: block.header.map((nodes, col) => cell(nodes, col, true)) }),
      ...block.rows.map((row) => new TableRow({ cantSplit: true, children: row.map((nodes, col) => cell(nodes, col, false)) })),
    ],
  });
  return [table, new Paragraph({ spacing: { after: 120 } })];
}

function convertList(block, ctx, depth) {
  const level = Math.min(depth, MAX_LEVEL);
  let reference = BULLET_REFERENCE;
  if (block.ordered) {
    reference = `${ctx.idPrefix}-ol-${ctx.numbering.length + 1}`;
    ctx.numbering.push(orderedNumbering(reference, level, block.start));
  }
  return block.items.flatMap((item) => [
    item.checked === undefined
      ? new Paragraph({ children: ctx.runs(item.children), numbering: { reference, level }, spacing: { after: 60 } })
      : new Paragraph({ children: [new TextRun({ text: `${item.checked ? CHECKED_BOX : EMPTY_BOX} ` }), ...ctx.runs(item.children)], indent: levelIndent(level), spacing: { after: 60 } }),
    ...item.blocks.flatMap((child) => convertBlock(child, ctx, depth + 1, { inItem: true })),
  ]);
}

function convertBlock(block, ctx, depth = 0, where = {}) {
  switch (block.type) {
    case 'heading':
      return [new Paragraph({ heading: HEADINGS[Math.min(6, Math.max(block.level, ctx.minHeading))], children: ctx.runs(block.children) })];
    case 'paragraph':
      return [new Paragraph({
        children: ctx.runs(block.children, where.inQuote ? { italics: true, color: '475569' } : {}),
        ...(where.inItem && { indent: { left: levelIndent(Math.min(depth - 1, MAX_LEVEL)).left } }),
        ...(where.inQuote && { indent: { left: 360 }, border: { left: line('FDBD10', 18, 8) } }),
      })];
    case 'list':
      return convertList(block, ctx, depth);
    case 'table':
      return convertTable(block, ctx);
    case 'quote':
      return block.blocks.flatMap((child) => convertBlock(child, ctx, depth + 1, { inQuote: true }));
    case 'rule':
      return [new Paragraph({ border: { bottom: line('AAAAAA', 6) }, spacing: { after: 160 } })];
    case 'code':
      return [
        ...block.text.split('\n').map((text) => new Paragraph({
          children: [new TextRun({ text, font: MONO, size: 20 })], shading: solid('F1F5F9'), spacing: { after: 0 },
        })),
        new Paragraph({ spacing: { after: 120 } }),
      ];
    default:
      return [];
  }
}

/**
 * @param {unknown} markdown
 * @param {{ idPrefix?: string, minHeading?: number, baseSize?: number }} [options]
 *   idPrefix: keeps list numbering apart when one document holds several texts;
 *   minHeading: the Word heading level that markdown's top level maps to;
 *   baseSize: font size in half-points, when it should differ from the document's.
 * @returns {{ children: Array<Paragraph | Table>, numbering: object[] }}
 */
export function markdownToDocx(markdown, { idPrefix = 'md', minHeading = 1, baseSize } = {}) {
  const ctx = { idPrefix, minHeading, runs: makeRuns(baseSize), numbering: [] };
  const children = parseMarkdown(markdown).flatMap((block) => convertBlock(block, ctx));
  return { children, numbering: ctx.numbering };
}
