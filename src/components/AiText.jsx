import { createElement, memo, useDeferredValue, useMemo } from 'react';
import { parseMarkdown } from '../utils/markdown/parse.js';

/**
 * Shows text written by the AI model (chat answers, drafts, suggestions) as a
 * formatted document: real headings, lists and tables, no markdown marks. It
 * builds React elements from a parsed tree and never uses raw HTML, so model
 * output cannot inject markup. Links are limited to http, https and mailto by
 * the parser.
 */

const BORDER = '#e2e8f0';

const THEMES = {
  document: {
    root: { fontSize: 14, lineHeight: 1.75 },
    paragraph: { margin: '0 0 10px' },
    list: { margin: '0 0 10px', paddingLeft: 24 },
    item: { marginBottom: 4 },
    heading: {
      1: { fontFamily: 'Lora, serif', fontSize: 19, fontWeight: 700, color: 'var(--u-navy)', margin: '28px 0 10px' },
      2: { fontSize: 15, fontWeight: 700, color: 'var(--u-navy)', margin: '24px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${BORDER}` },
      3: { fontSize: 14, fontWeight: 700, color: 'var(--u-navy)', margin: '18px 0 6px' },
      4: { fontSize: 13.5, fontWeight: 700, color: '#334155', margin: '14px 0 4px' },
    },
    cellPadding: '8px 12px',
  },
  chat: {
    root: { fontSize: 13, lineHeight: 1.6 },
    paragraph: { margin: '0 0 8px' },
    list: { margin: '0 0 8px', paddingLeft: 20 },
    item: { marginBottom: 3 },
    heading: {
      1: { fontSize: 15, fontWeight: 700, color: 'var(--u-navy)', margin: '12px 0 4px' },
      2: { fontSize: 14, fontWeight: 700, color: 'var(--u-navy)', margin: '12px 0 4px' },
      3: { fontSize: 13, fontWeight: 700, color: 'var(--u-navy)', margin: '10px 0 3px' },
      4: { fontSize: 13, fontWeight: 600, color: '#334155', margin: '8px 0 2px' },
    },
    cellPadding: '5px 8px',
  },
};

const STYLES = {
  link: { color: 'var(--u-navy-l)', textDecoration: 'underline', textUnderlineOffset: 2 },
  inlineCode: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 },
  marker: { background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 4, fontSize: '0.9em', fontWeight: 600 },
  quote: { margin: '0 0 10px', padding: '6px 14px', borderLeft: '3px solid var(--u-gold)', background: '#f8fafc', color: '#475569' },
  rule: { border: 0, borderTop: `1px solid ${BORDER}`, margin: '16px 0' },
  codeBlock: { margin: '0 0 10px', padding: '10px 12px', background: '#f1f5f9', borderRadius: 6, overflowX: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.5 },
  tableWrap: { overflowX: 'auto', margin: '0 0 12px' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: '0.95em' },
};

/** Where the top heading of the text sits when its caller does not say: under the page's h1, or small inside a chat bubble. */
const DEFAULT_HEADING_START = { document: 2, chat: 4 };
const MOST_SPECIFIC_HEADING = 6;

/** The Word-for-screen heading level: the text's top heading goes at `headingStart`, the rest follow in order. */
const headingTag = (ctx, level) => `h${Math.min(MOST_SPECIFIC_HEADING, Math.max(1, ctx.headingStart + level - ctx.topLevel))}`;
/** How a heading looks depends on how it was written (# is a title, ## a section), not on where it sits. */
const headingStyle = (theme, level) => theme.heading[Math.min(level, 4)];

function Inline({ nodes }) {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'break':
        return <br key={i} />;
      case 'strong':
        return <strong key={i}><Inline nodes={node.children} /></strong>;
      case 'em':
        return <em key={i}><Inline nodes={node.children} /></em>;
      case 'code':
        return <code key={i} style={STYLES.inlineCode}>{node.text}</code>;
      case 'marker':
        return <span key={i} style={STYLES.marker}>{'⚠'} NEEDS INPUT: {node.text}</span>;
      case 'link':
        return <a key={i} href={node.href} title={node.href} target="_blank" rel="noopener noreferrer" style={STYLES.link}><Inline nodes={node.children} /></a>;
      default:
        return null;
    }
  });
}

/** The first block sits flush with the top of its box and the last with the bottom. */
const atEdges = (style, { first, last }) => ({ ...style, ...(first && { marginTop: 0 }), ...(last && { marginBottom: 0 }) });

function ListItem({ item, ctx }) {
  const isTask = item.checked !== undefined;
  const style = isTask ? { ...ctx.theme.item, listStyle: 'none', marginLeft: -4 } : ctx.theme.item;
  return (
    <li style={style}>
      {isTask && <span aria-hidden="true">{`${item.checked ? '\u2611' : '\u2610'} `}</span>}
      <Inline nodes={item.children} />
      {item.blocks.map((child, j) => <Block key={j} block={child} ctx={ctx} nested />)}
    </li>
  );
}

function List({ block, ctx, nested, edge }) {
  const Tag = block.ordered ? 'ol' : 'ul';
  const style = atEdges(nested ? { ...ctx.theme.list, margin: '4px 0 0' } : ctx.theme.list, edge);
  return (
    <Tag start={block.ordered && block.start !== 1 ? block.start : undefined} style={style}>
      {block.items.map((item, i) => <ListItem key={i} item={item} ctx={ctx} />)}
    </Tag>
  );
}

function Table({ block, ctx: { theme }, edge }) {
  const cellStyle = (col) => ({ padding: theme.cellPadding, border: `1px solid ${BORDER}`, textAlign: block.align[col] ?? undefined, verticalAlign: 'top' });
  return (
    <div style={atEdges(STYLES.tableWrap, edge)}>
      <table style={STYLES.table}>
        <thead>
          <tr>
            {block.header.map((cell, col) => (
              <th key={col} scope="col" style={{ ...cellStyle(col), background: '#f1f5f9', color: 'var(--u-navy)', fontWeight: 700 }}><Inline nodes={cell} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} style={r % 2 ? { background: '#f8fafc' } : undefined}>
              {row.map((cell, col) => <td key={col} style={cellStyle(col)}><Inline nodes={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ block, ctx, nested = false, edge = {} }) {
  switch (block.type) {
    case 'heading':
      return createElement(
        headingTag(ctx, block.level),
        { style: atEdges(headingStyle(ctx.theme, block.level), edge) },
        <Inline nodes={block.children} />,
      );
    case 'paragraph':
      return <p style={atEdges(nested ? { ...ctx.theme.paragraph, margin: '4px 0 0' } : ctx.theme.paragraph, edge)}><Inline nodes={block.children} /></p>;
    case 'list':
      return <List block={block} ctx={ctx} nested={nested} edge={edge} />;
    case 'table':
      return <Table block={block} ctx={ctx} edge={edge} />;
    case 'quote':
      return <blockquote style={atEdges(STYLES.quote, edge)}>{block.blocks.map((b, i) => <Block key={i} block={b} ctx={ctx} nested />)}</blockquote>;
    case 'rule':
      return <hr style={atEdges(STYLES.rule, edge)} />;
    case 'code':
      return <pre style={atEdges(STYLES.codeBlock, edge)}><code>{block.text}</code></pre>;
    default:
      return null;
  }
}

/**
 * @param {{ text?: unknown, variant?: 'document' | 'chat', headingStart?: number }} props
 *   `headingStart` is the heading level (1 to 6) given to the top heading of the text; set it to one more than the
 *   heading the text sits under, so the page's heading order stays unbroken.
 */
function AiText({ text, variant = 'document', headingStart }) {
  const shown = useDeferredValue(text);
  const blocks = useMemo(() => parseMarkdown(shown), [shown]);
  if (!blocks.length) return null;
  const known = Object.hasOwn(THEMES, variant) ? variant : 'document';
  const levels = blocks.filter((block) => block.type === 'heading').map((block) => block.level);
  const ctx = { theme: THEMES[known], headingStart: headingStart ?? DEFAULT_HEADING_START[known], topLevel: levels.length ? Math.min(...levels) : 1 };
  return (
    <div data-variant={known} style={{ fontFamily: 'Inter, sans-serif', color: '#1e293b', overflowWrap: 'break-word', ...ctx.theme.root }}>
      {blocks.map((block, i) => <Block key={i} block={block} ctx={ctx} edge={{ first: i === 0, last: i === blocks.length - 1 }} />)}
    </div>
  );
}

export default memo(AiText);
