import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parse.js';
import { parseInline } from './inline.js';
import { markdownToPlainText } from './plain.js';

const t = (text) => ({ type: 'text', text });
const link = (href, ...children) => ({ type: 'link', href, children });
const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);
const LONE_SURROGATE = String.fromCharCode(0xd800);

/** How long `work` takes, in milliseconds. */
function timed(work) {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe('inline: <br> is a line break', () => {
  it.each(['<br>', '<br/>', '<br />', '<BR>', '<Br />'])('reads %s as a break', (tag) => {
    expect(parseInline(`a${tag}b`)).toEqual([t('a'), { type: 'break' }, t('b')]);
  });

  it('reads a <br> inside a table cell, so a cell can hold several lines', () => {
    const [table] = parseMarkdown('| a | b |\n|---|---|\n| x<br>y | z |');
    expect(table.rows[0][0]).toEqual([t('x'), { type: 'break' }, t('y')]);
  });

  it('leaves other tags as text', () => {
    expect(parseInline('<b>x</b> <brx> <br')).toEqual([t('<b>x</b> <brx> <br')]);
  });
});

describe('inline: web addresses become links', () => {
  it('links a bare https address, leaving the full stop outside', () => {
    expect(parseInline('see https://omri.org/search.')).toEqual([t('see '), link('https://omri.org/search', t('https://omri.org/search')), t('.')]);
  });

  it('links an address written with www, and makes its target https', () => {
    expect(parseInline('go to www.omri.org/x now')).toEqual([t('go to '), link('https://www.omri.org/x', t('www.omri.org/x')), t(' now')]);
  });

  it('links an address in angle brackets, without the brackets', () => {
    expect(parseInline('<https://x.org/a>')).toEqual([link('https://x.org/a', t('https://x.org/a'))]);
  });

  it('keeps a balanced closing parenthesis and drops an unbalanced one', () => {
    expect(parseInline('https://x.org/a_(b)')).toEqual([link('https://x.org/a_(b)', t('https://x.org/a_(b)'))]);
    expect(parseInline('(see https://x.org/a)')).toEqual([t('(see '), link('https://x.org/a', t('https://x.org/a')), t(')')]);
  });

  it('leaves closing emphasis marks outside the link', () => {
    expect(parseInline('**https://x.org**')).toEqual([{ type: 'strong', children: [link('https://x.org', t('https://x.org'))] }]);
  });

  it('does not link inside a word, a code span or a link label, and never links other schemes', () => {
    expect(parseInline('xhttps://a.org')).toEqual([t('xhttps://a.org')]);
    expect(parseInline('`https://a.org`')).toEqual([{ type: 'code', text: 'https://a.org' }]);
    expect(parseInline('[see https://a.org](https://b.org)')).toEqual([link('https://b.org', t('see https://a.org'))]);
    expect(parseInline('javascript:alert(1) and ftp://x.org')).toEqual([t('javascript:alert(1) and ftp://x.org')]);
  });

  it('does not read emphasis marks inside an address', () => {
    expect(parseInline('https://x.org/a_b_c and *x*')).toEqual([link('https://x.org/a_b_c', t('https://x.org/a_b_c')), t(' and '), { type: 'em', children: [t('x')] }]);
  });
});

describe('inline: a link must be what it says', () => {
  it('shows the real address when the words look like a different address', () => {
    expect(parseInline('[https://cdfa.ca.gov](https://evil.example/x)')).toEqual([link('https://evil.example/x', t('https://evil.example/x'))]);
    expect(parseInline('[cdfa.ca.gov](https://evil.example)')).toEqual([link('https://evil.example', t('https://evil.example'))]);
  });

  it('keeps the words when they are the same site, or are not an address', () => {
    expect(parseInline('[www.cdfa.ca.gov/organic](https://cdfa.ca.gov/x)')).toEqual([link('https://cdfa.ca.gov/x', t('www.cdfa.ca.gov/organic'))]);
    expect(parseInline('[CDFA](https://cdfa.ca.gov)')).toEqual([link('https://cdfa.ca.gov', t('CDFA'))]);
    expect(parseInline('[see Table 2.1](https://cdfa.ca.gov)')).toEqual([link('https://cdfa.ca.gov', t('see Table 2.1'))]);
  });

  it('makes a target written with www into an https link', () => {
    expect(parseInline('[OMRI list](www.omri.org/x)')).toEqual([link('https://www.omri.org/x', t('OMRI list'))]);
  });

  it('uses the address as the words when there are no words', () => {
    expect(parseInline('[](https://x.org)')).toEqual([link('https://x.org', t('https://x.org'))]);
  });

  it('takes the query off a mailto address, which can add hidden recipients and a body', () => {
    expect(parseInline('[mail](mailto:a@b.org?bcc=evil@e.com&body=hi)')).toEqual([link('mailto:a@b.org', t('mail'))]);
  });

  it('refuses a target with a control character in it', () => {
    expect(parseInline(`[a](mailto:a@b.org${NUL})`)).toEqual([t('a')]);
    expect(parseInline(`[a](https://x.org/${String.fromCharCode(7)})`)).toEqual([t('a')]);
  });
});

describe('parseMarkdown: text with characters Word and XML cannot hold', () => {
  it('removes control characters, direction overrides and lone surrogate halves', () => {
    expect(parseMarkdown(`a${NUL}b${RLO}c${LONE_SURROGATE}d`)).toEqual([{ type: 'paragraph', children: [t('abcd')] }]);
  });

  it('keeps a real emoji, which is a pair of halves', () => {
    expect(parseMarkdown('ok \u{1F331}')).toEqual([{ type: 'paragraph', children: [t('ok \u{1F331}')] }]);
  });
});

describe('parseMarkdown: limits that keep a long answer from freezing the page', () => {
  it('does not turn a header of more than thirty columns into a table', () => {
    const header = `${'|a'.repeat(31)}|`;
    expect(parseMarkdown(`${header}\n${'|-'.repeat(31)}|\n${'|1'.repeat(31)}|`).map((b) => b.type)).toEqual(['paragraph']);
  });

  it('keeps a table to a few thousand cells, and shows the rest as text', () => {
    const header = `${'|a'.repeat(30)}|`;
    const blocks = parseMarkdown(`${header}\n${'|-'.repeat(30)}|\n${'|\n'.repeat(5000)}`);
    const [table] = blocks;
    expect(table.type).toBe('table');
    expect(table.rows.length * table.header.length).toBeLessThanOrEqual(3000);
    expect(JSON.stringify(blocks).length).toBeLessThan(2_000_000);
  });

  it('does not build millions of cells from a few thousand characters', () => {
    const started = performance.now();
    const text = `${'|a'.repeat(30)}|\n${'|-'.repeat(30)}|\n${'|\n'.repeat(12000)}`;
    parseMarkdown(text);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('reads a fence line with a very long information string quickly', () => {
    expect(timed(() => parseMarkdown(`\`\`\`${'a'.repeat(50000)}\``))).toBeLessThan(300);
  });

  it('reads a heading padded with a long run of spaces quickly', () => {
    expect(timed(() => parseMarkdown(`# a${' '.repeat(30000)}b`))).toBeLessThan(300);
    expect(parseMarkdown('## Title ##   ')).toEqual([{ type: 'heading', level: 2, children: [t('Title')] }]);
  });

  it('reads many unmatched emphasis marks quickly, as plain text', () => {
    const text = 'a* '.repeat(16000);
    expect(timed(() => parseMarkdown(text))).toBeLessThan(500);
    expect(JSON.stringify(parseMarkdown(text))).not.toContain('"em"');
  });

  it('shows an enormous answer as plain text, without reading any markup in it', () => {
    const blocks = parseMarkdown('**x** '.repeat(30000));
    expect(blocks.every((b) => b.type === 'paragraph')).toBe(true);
    expect(JSON.stringify(blocks)).not.toContain('"strong"');
    expect(JSON.stringify(blocks)).toContain('**x**');
  });

  it('keeps the line breaks of an enormous answer', () => {
    const blocks = parseMarkdown(`${'line\n'.repeat(30000)}`);
    expect(JSON.stringify(blocks)).toContain('"break"');
  });

  it('does not overflow the stack on emphasis nested thousands of levels deep', () => {
    const nested = `${'*a '.repeat(1000)}x*${' b*'.repeat(999)}`;
    expect(() => parseMarkdown(nested)).not.toThrow();
    expect(() => markdownToPlainText(nested)).not.toThrow();
    expect(markdownToPlainText(nested)).toContain('x');
  });
});

describe('parseMarkdown: checklists', () => {
  it('reads [ ] and [x] at the start of an item as an unticked or ticked box', () => {
    const [list] = parseMarkdown('- [ ] Check logs\n- [x] Sign form\n- [X] Pay fee');
    expect(list.items.map((i) => i.checked)).toEqual([false, true, true]);
    expect(list.items[0].children).toEqual([t('Check logs')]);
  });

  it('reads checkboxes on numbered items too', () => {
    const [list] = parseMarkdown('1. [ ] first\n2. [x] second');
    expect(list.items.map((i) => i.checked)).toEqual([false, true]);
  });

  it('leaves other square brackets in an item alone', () => {
    const [list] = parseMarkdown('- [link](https://x.org)\n- [] empty\n- [ ]no space\n- [y] other\n- plain');
    for (const item of list.items) expect(item).not.toHaveProperty('checked');
    expect(list.items[0].children).toEqual([link('https://x.org', t('link'))]);
  });

  it('does not add a checked property to an ordinary item', () => {
    const [list] = parseMarkdown('- a');
    expect(list.items[0]).toEqual({ children: [t('a')], blocks: [] });
  });
});

describe('inline: what emphasis will and will not read', () => {
  const depth = (nodes) => Math.max(0, ...nodes.map((n) => (n.children ? 1 + depth(n.children) : 0)));

  it('reads thousands of marks as plain text rather than slowly, once there are too many to match', () => {
    const many = '*a* '.repeat(2001);
    expect(parseInline(many).some((n) => n.type === 'em')).toBe(false);
    expect(parseInline('*a* '.repeat(500)).filter((n) => n.type === 'em')).toHaveLength(500);
  });

  it('reads a very long run of unmatched marks fast', () => {
    expect(timed(() => parseInline('a* '.repeat(33000)))).toBeLessThan(400);
  });

  it('does not nest emphasis more than eight deep, and leaves the rest as text', () => {
    const nodes = parseInline(`${'*a '.repeat(12)}x*${' b*'.repeat(11)}`);
    expect(depth(nodes)).toBe(8);
    expect(JSON.stringify(nodes)).toContain('x');
  });

  it('does not make a link of an address the URL parser cannot read', () => {
    expect(parseInline('see https://[bad')).toEqual([t('see https://[bad')]);
  });
});

describe('parseMarkdown: what is and is not a code fence', () => {
  it('does not take a backtick line with a backtick in its information string for a fence', () => {
    expect(parseMarkdown('```a`b\ntext').map((b) => b.type)).toEqual(['paragraph']);
    expect(parseMarkdown('```x``` trailing').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('lets a tilde fence have backticks in its information string', () => {
    expect(parseMarkdown('~~~ a`b\ncode\n~~~')).toEqual([{ type: 'code', lang: 'a`b', text: 'code' }]);
  });

  it('does not take a fence indented four spaces for a fence', () => {
    expect(parseMarkdown('    ```\n    x').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('takes the first word of the information string as the language', () => {
    expect(parseMarkdown('```  python  extra\nx\n```')).toEqual([{ type: 'code', lang: 'python', text: 'x' }]);
  });
});

describe('parseMarkdown: nesting and size limits', () => {
  const listDepth = (blocks) => Math.max(0, ...blocks.map((b) => (b.type === 'list' ? 1 + Math.max(0, ...b.items.map((i) => listDepth(i.blocks))) : 0)));

  it('flattens lists nested deeper than nine levels into text, keeping every word', () => {
    const text = Array.from({ length: 14 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n');
    const blocks = parseMarkdown(text);
    expect(listDepth(blocks)).toBe(9);
    expect(JSON.stringify(blocks)).toContain('level 13');
  });

  it('shows an answer over a hundred thousand characters as plain paragraphs, one per blank-line-separated chunk', () => {
    const blocks = parseMarkdown(`# Title\n\n${'**bold** line\n\n'.repeat(8000)}`);
    expect(blocks.some((b) => b.type === 'heading')).toBe(false);
    expect(blocks.length).toBeGreaterThan(7000);
    expect(JSON.stringify(blocks)).not.toContain('"strong"');
    expect(JSON.stringify(blocks.slice(0, 2))).toContain('**bold** line');
  });

  it('still lays out an answer just under the limit', () => {
    const blocks = parseMarkdown(`# Title\n\n${'word '.repeat(15000)}`);
    expect(blocks[0].type).toBe('heading');
  });
});

