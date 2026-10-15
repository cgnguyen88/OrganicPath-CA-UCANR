import { neutralizeFormula } from '../../domain/records/csv.js';
import { parseMarkdown } from './parse.js';

/**
 * Markdown → clean plain text, for the Copy buttons and anywhere a document
 * has to leave the app without its markup. Lists get real bullets, tables are
 * tab-separated (they paste into a spreadsheet or a Word table), links keep
 * their address in brackets.
 */

const RULE_LINE = '-'.repeat(40);
const BULLET = '•';
const INDENT = '  ';
const BOX = { true: '\u2611', false: '\u2610' };
const PLAIN_NUMBER = /^[+-]?\d[\d.,]*%?$/;
const SIGN_AND_NOTHING_ELSE = /^[+-]$|^[+-]\s/;

/**
 * @param {object[]} nodes inline nodes
 * @returns {string}
 */
export function inlineToPlainText(nodes) {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
      case 'code':
        return node.text;
      case 'break':
        return '\n';
      case 'marker':
        return `[NEEDS OPERATOR INPUT: ${node.text}]`;
      case 'link': {
        const label = inlineToPlainText(node.children);
        return label === node.href ? label : `${label} (${node.href})`;
      }
      default:
        return inlineToPlainText(node.children ?? []);
    }
  }).join('');
}

const indentLines = (text, prefix) => text.split('\n').map((line) => (line ? prefix + line : line)).join('\n');

/** A table cell for pasting into a spreadsheet: on one line, and never starting like a formula. */
function cellToPlainText(nodes) {
  const text = inlineToPlainText(nodes).replace(/\s*\n\s*/g, ' ');
  return PLAIN_NUMBER.test(text) || SIGN_AND_NOTHING_ELSE.test(text) ? text : neutralizeFormula(text);
}

function markerFor(block, item, index) {
  if (item.checked !== undefined) return `${BOX[item.checked]} `;
  return block.ordered ? `${block.start + index}. ` : `${BULLET} `;
}

function listToPlainText(block) {
  return block.items.map((item, index) => {
    const marker = markerFor(block, item, index);
    const head = inlineToPlainText(item.children);
    const nested = item.blocks.map((b) => blockToPlainText(b)).join('\n');
    const hanging = ' '.repeat(marker.length);
    const own = head.split('\n').map((line, i) => (i === 0 ? marker + line : hanging + line)).join('\n');
    return nested ? `${own}\n${indentLines(nested, INDENT)}` : own;
  }).join('\n');
}

function blockToPlainText(block) {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return inlineToPlainText(block.children);
    case 'list':
      return listToPlainText(block);
    case 'table':
      return [block.header, ...block.rows].map((row) => row.map(cellToPlainText).join('\t')).join('\n');
    case 'quote':
      return indentLines(block.blocks.map(blockToPlainText).join('\n\n'), INDENT);
    case 'rule':
      return RULE_LINE;
    case 'code':
      return block.text;
    default:
      return '';
  }
}

/**
 * @param {unknown} markdown
 * @returns {string}
 */
export function markdownToPlainText(markdown) {
  return parseMarkdown(markdown).map(blockToPlainText).filter(Boolean).join('\n\n');
}
