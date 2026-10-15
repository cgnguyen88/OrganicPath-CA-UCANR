import { cleanText } from '../../domain/records/csv.js';
import { parseInline } from './inline.js';

/**
 * Markdown → a tree of plain objects (headings, paragraphs, lists, tables,
 * quotes, rules, code). It never throws and never produces HTML. It is
 * tolerant of half-written text, because the same function renders an answer
 * while it is still streaming in.
 *
 * Blocks: heading, paragraph, list, table, quote, rule, code.
 */

const MAX_DEPTH = 8;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HEADING_CLOSER = /(?:^|[ \t])#+$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const BULLET = /^( *)([-*+•])( +|$)(.*)$/;
const ORDERED = /^( *)(\d{1,9})([.)])( +|$)(.*)$/;
const SEPARATOR_CELL = /^:?-+:?$/;
const LIST_CHILD_INDENT = 2;
const TAB_WIDTH = 4;
const MAX_TABLE_COLUMNS = 30;
const MAX_TABLE_CELLS = 3000;
const MAX_MARKDOWN_CHARS = 100_000;

const hasPipe = (line) => line.replace(/\\\|/g, '').includes('|');
const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === '';

/** A code fence's opening line, or null. A backtick fence cannot have a backtick in its information string. */
function matchFence(line) {
  const open = FENCE_OPEN.exec(line);
  if (!open) return null;
  const [, indent, fence, info] = open;
  if (fence[0] === '`' && info.includes('`')) return null;
  return { indent, fence, lang: info.trim().split(/\s+/)[0] };
}

/** `[ ]` or `[x]` at the start of an item's text makes it a checklist item. */
function withTask(item) {
  const task = TASK.exec(item.rest);
  return task ? { ...item, rest: task[2], checked: task[1] !== ' ' } : item;
}

function matchItem(line) {
  const bullet = BULLET.exec(line);
  if (bullet) return withTask({ indent: bullet[1].length, ordered: false, number: 1, rest: bullet[4] });
  const ordered = ORDERED.exec(line);
  if (ordered) return withTask({ indent: ordered[1].length, ordered: true, number: Number(ordered[2]), rest: ordered[5] });
  return null;
}

function splitRow(line) {
  const trimmed = line.trim();
  const cells = [];
  let cell = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '\\' && i + 1 < trimmed.length) {
      cell += trimmed[i] + trimmed[i + 1];
      i += 1;
    } else if (trimmed[i] === '|') {
      cells.push(cell);
      cell = '';
    } else {
      cell += trimmed[i];
    }
  }
  cells.push(cell);
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|') && cells.length) cells.pop();
  return cells.map((c) => c.trim());
}

function separatorAlignments(line) {
  if (!hasPipe(line)) return null;
  const cells = splitRow(line);
  if (!cells.length || !cells.every((c) => SEPARATOR_CELL.test(c))) return null;
  return cells.map((c) => {
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.startsWith(':')) return 'left';
    if (c.endsWith(':')) return 'right';
    return null;
  });
}

function isTableStart(lines, i) {
  if (i + 1 >= lines.length || !hasPipe(lines[i])) return false;
  const align = separatorAlignments(lines[i + 1]);
  const columns = splitRow(lines[i]).length;
  return align !== null && align.length === columns && columns <= MAX_TABLE_COLUMNS;
}

/** Can this line end a paragraph that is still being written? */
function interruptsParagraph(lines, i) {
  const line = lines[i];
  if (matchFence(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const item = matchItem(line);
  if (item && item.rest.trim() && (!item.ordered || item.number === 1)) return true;
  return isTableStart(lines, i);
}

function parseTable(lines, start) {
  const header = splitRow(lines[start]);
  const align = separatorAlignments(lines[start + 1]);
  const rows = [];
  const maxRows = Math.floor(MAX_TABLE_CELLS / header.length);
  let i = start + 2;
  while (i < lines.length && rows.length < maxRows && !isBlank(lines[i]) && hasPipe(lines[i])) {
    const cells = splitRow(lines[i]);
    rows.push(header.map((_, col) => parseInline(cells[col] ?? '')));
    i += 1;
  }
  return [{ type: 'table', align, header: header.map((c) => parseInline(c)), rows }, i];
}

function parseFence(lines, start) {
  const { indent, fence, lang } = matchFence(lines[start]);
  const body = [];
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    const close = FENCE_CLOSE.exec(lines[i]);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
      i += 1;
      break;
    }
    body.push(lines[i].slice(Math.min(indent.length, indentOf(lines[i]))));
  }
  return [{ type: 'code', lang, text: body.join('\n') }, i];
}

function parseQuote(lines, start, depth) {
  const inner = [];
  let i = start;
  for (; i < lines.length && QUOTE.test(lines[i]); i += 1) inner.push(lines[i].replace(/^ {0,3}> ?/, ''));
  return [{ type: 'quote', blocks: parseBlocks(inner, depth + 1) }, i];
}

/** The lines that belong to the list item starting at `start` (its own text first, children dedented), and where it ends. */
function collectItemLines(lines, start, item) {
  const inner = [item.rest];
  const childIndent = item.indent + LIST_CHILD_INDENT;
  let i = start + 1;
  while (i < lines.length) {
    if (isBlank(lines[i])) inner.push('');
    else if (indentOf(lines[i]) >= childIndent) inner.push(lines[i].slice(childIndent));
    else break;
    i += 1;
  }
  return [inner, i];
}

function parseItem(innerLines, depth, checked) {
  const blocks = parseBlocks(innerLines, depth + 1);
  const first = blocks[0]?.type === 'paragraph';
  return {
    children: first ? blocks[0].children : [],
    blocks: first ? blocks.slice(1) : blocks,
    ...(checked !== undefined && { checked }),
  };
}

function parseList(lines, start, depth) {
  const first = matchItem(lines[start]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const item = matchItem(lines[i]);
    if (!item || item.ordered !== first.ordered) break;
    const [innerLines, end] = collectItemLines(lines, i, item);
    items.push(parseItem(innerLines, depth, item.checked));
    i = end;
  }
  return [{ type: 'list', ordered: first.ordered, start: first.ordered ? first.number : 1, items }, i];
}

function parseParagraph(lines, start) {
  const text = [lines[start].trim()];
  let i = start + 1;
  while (i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines, i)) {
    text.push(lines[i].trim());
    i += 1;
  }
  return [{ type: 'paragraph', children: parseInline(text.join('\n')) }, i];
}

function parseHeading(line) {
  const [, hashes, content = ''] = HEADING.exec(line);
  return { type: 'heading', level: hashes.length, children: parseInline(content.trim().replace(HEADING_CLOSER, '').trim()) };
}

function parseBlocks(lines, depth) {
  if (depth > MAX_DEPTH) {
    const text = lines.map((l) => l.trim()).filter(Boolean).join('\n');
    return text ? [{ type: 'paragraph', children: parseInline(text) }] : [];
  }
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let block;
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    if (matchFence(line)) [block, i] = parseFence(lines, i);
    else if (HEADING.test(line)) [block, i] = [parseHeading(line), i + 1];
    else if (RULE.test(line)) [block, i] = [{ type: 'rule' }, i + 1];
    else if (QUOTE.test(line)) [block, i] = parseQuote(lines, i, depth);
    else if (isTableStart(lines, i)) [block, i] = parseTable(lines, i);
    else if (matchItem(line)) [block, i] = parseList(lines, i, depth);
    else [block, i] = parseParagraph(lines, i);
    blocks.push(block);
  }
  return blocks;
}

function expandLeadingTabs(line) {
  return line.replace(/^[ \t]+/, (lead) => lead.replace(/\t/g, ' '.repeat(TAB_WIDTH)));
}

/** An answer too long to lay out is shown as paragraphs of plain text, with no markup read in it. */
function plainParagraphs(text) {
  return text.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => ({
    type: 'paragraph',
    children: chunk.split('\n').flatMap((line, index) => [...(index ? [{ type: 'break' }] : []), { type: 'text', text: line }]),
  }));
}

/**
 * @param {unknown} markdown
 * @returns {object[]} blocks; empty for anything that is not text
 */
export function parseMarkdown(markdown) {
  if (typeof markdown !== 'string') return [];
  const text = cleanText(markdown);
  if (text.length > MAX_MARKDOWN_CHARS) return plainParagraphs(text);
  return parseBlocks(text.split('\n').map(expandLeadingTabs), 0);
}
