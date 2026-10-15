import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parse.js';
import { parseInline } from './inline.js';

const t = (text) => ({ type: 'text', text });
const strong = (...children) => ({ type: 'strong', children });
const em = (...children) => ({ type: 'em', children });
const code = (text) => ({ type: 'code', text });
const para = (...children) => ({ type: 'paragraph', children });
const heading = (level, ...children) => ({ type: 'heading', level, children });

describe('parseInline: emphasis', () => {
  it('reads **bold**, __bold__, *italic* and _italic_', () => {
    expect(parseInline('a **b** c')).toEqual([t('a '), strong(t('b')), t(' c')]);
    expect(parseInline('a __b__ c')).toEqual([t('a '), strong(t('b')), t(' c')]);
    expect(parseInline('a *b* c')).toEqual([t('a '), em(t('b')), t(' c')]);
    expect(parseInline('a _b_ c')).toEqual([t('a '), em(t('b')), t(' c')]);
  });

  it('reads italic inside bold and bold inside italic', () => {
    expect(parseInline('**a *b* c**')).toEqual([strong(t('a '), em(t('b')), t(' c'))]);
    expect(parseInline('*a **b** c*')).toEqual([em(t('a '), strong(t('b')), t(' c'))]);
  });

  it('reads bold-italic ***text***', () => {
    expect(parseInline('***x***')).toEqual([em(strong(t('x')))]);
  });

  it('leaves what is not closed as plain text, so a half-written (streaming) answer does not flicker into odd shapes', () => {
    expect(parseInline('a **b')).toEqual([t('a **b')]);
    expect(parseInline('a *b')).toEqual([t('a *b')]);
    expect(parseInline('**')).toEqual([t('**')]);
    expect(parseInline('a `b')).toEqual([t('a `b')]);
    expect(parseInline('[a](mailto:a@b.org')).toEqual([t('[a](mailto:a@b.org')]);
    expect(parseInline('[a](http://x.com')).toEqual([t('[a]('), { type: 'link', href: 'http://x.com', children: [t('http://x.com')] }]);
  });

  it('does not treat a lone asterisk or arithmetic as emphasis', () => {
    expect(parseInline('5 * 3 = 15 and 2 * 4')).toEqual([t('5 * 3 = 15 and 2 * 4')]);
    expect(parseInline('a * b * c')).toEqual([t('a * b * c')]);
  });

  it('does not italicize underscores inside words (snake_case, file_names)', () => {
    expect(parseInline('use snake_case_name here')).toEqual([t('use snake_case_name here')]);
    expect(parseInline('file_name.txt and other_file.txt')).toEqual([t('file_name.txt and other_file.txt')]);
  });

  it('does not read emphasis with a space just inside it', () => {
    expect(parseInline('** not bold **')).toEqual([t('** not bold **')]);
    expect(parseInline('* not italic *')).toEqual([t('* not italic *')]);
  });

  it('keeps bold that spans punctuation', () => {
    expect(parseInline('**Note:** done')).toEqual([strong(t('Note:')), t(' done')]);
    expect(parseInline('(**yes**)')).toEqual([t('('), strong(t('yes')), t(')')]);
  });
});

describe('parseInline: code, escapes and links', () => {
  it('reads `code` and shows its content literally', () => {
    expect(parseInline('run `npm *test*` now')).toEqual([t('run '), code('npm *test*'), t(' now')]);
  });

  it('reads a double-backtick code span containing a backtick', () => {
    expect(parseInline('``a ` b``')).toEqual([code('a ` b')]);
  });

  it('reads backslash escapes as the literal character', () => {
    expect(parseInline('\\*not bold\\*')).toEqual([t('*not bold*')]);
    expect(parseInline('a \\_b\\_ c')).toEqual([t('a _b_ c')]);
    expect(parseInline('trailing \\')).toEqual([t('trailing \\')]);
  });

  it('reads a link with an https address', () => {
    expect(parseInline('see [CDFA](https://www.cdfa.ca.gov/) now')).toEqual([t('see '), { type: 'link', href: 'https://www.cdfa.ca.gov/', children: [t('CDFA')] }, t(' now')]);
  });

  it('accepts http and mailto, and ignores a link title', () => {
    expect(parseInline('[a](http://x.org "title")')).toEqual([{ type: 'link', href: 'http://x.org', children: [t('a')] }]);
    expect(parseInline('[mail](mailto:a@b.org)')).toEqual([{ type: 'link', href: 'mailto:a@b.org', children: [t('mail')] }]);
  });

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x', 'file:///etc/passwd', '//evil.example/x', '/relative/path', 'ftp://x.org', 'java\tscript:alert(1)',
  ])('never makes a clickable link of %j: only the words show', (href) => {
    const nodes = parseInline(`[click me](${href})`);
    expect(nodes.some((n) => n.type === 'link')).toBe(false);
    expect(nodes).toEqual([t('click me')]);
  });

  it('puts formatting inside a link label', () => {
    expect(parseInline('[**bold** link](https://x.org)')).toEqual([{ type: 'link', href: 'https://x.org', children: [strong(t('bold')), t(' link')] }]);
  });

  it('shows the [NEEDS OPERATOR INPUT: …] marker as its own node, not as a link or text', () => {
    expect(parseInline('Name: [NEEDS OPERATOR INPUT: your legal name]')).toEqual([t('Name: '), { type: 'marker', text: 'your legal name' }]);
  });

  it('leaves other square brackets alone', () => {
    expect(parseInline('a [b] c')).toEqual([t('a [b] c')]);
    expect(parseInline('[b]()')).toEqual([t('[b]()')]);
  });

  it('keeps raw HTML as plain text (the screen escapes it)', () => {
    expect(parseInline('<script>alert(1)</script> and <b>x</b>')).toEqual([t('<script>alert(1)</script> and <b>x</b>')]);
  });
});

describe('parseMarkdown: blocks', () => {
  it('gives nothing for empty or blank input and never throws on odd input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\n  ')).toEqual([]);
    for (const odd of [null, undefined, 5, {}, []]) expect(parseMarkdown(odd)).toEqual([]);
  });

  it('reads headings of level 1 to 6, with or without closing hashes', () => {
    expect(parseMarkdown('# One\n## Two ##\n### Three\n#### Four\n##### Five\n###### Six')).toEqual([
      heading(1, t('One')), heading(2, t('Two')), heading(3, t('Three')), heading(4, t('Four')), heading(5, t('Five')), heading(6, t('Six')),
    ]);
  });

  it('does not read #hashtag or seven hashes as a heading', () => {
    expect(parseMarkdown('#hashtag')).toEqual([para(t('#hashtag'))]);
    expect(parseMarkdown('####### seven')).toEqual([para(t('####### seven'))]);
  });

  it('formats inline marks inside a heading', () => {
    expect(parseMarkdown('## **Soil** health')).toEqual([heading(2, strong(t('Soil')), t(' health'))]);
  });

  it('makes paragraphs of blocks separated by a blank line, and line breaks of single newlines', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([para(t('one'), { type: 'break' }, t('two')), para(t('three'))]);
  });

  it('reads CRLF line endings like LF', () => {
    expect(parseMarkdown('a\r\n\r\nb')).toEqual([para(t('a')), para(t('b'))]);
  });

  it('reads a horizontal rule', () => {
    expect(parseMarkdown('a\n\n---\n\nb')).toEqual([para(t('a')), { type: 'rule' }, para(t('b'))]);
    expect(parseMarkdown('***')).toEqual([{ type: 'rule' }]);
    expect(parseMarkdown('___')).toEqual([{ type: 'rule' }]);
    expect(parseMarkdown('* * *')).toEqual([{ type: 'rule' }]);
  });

  it('reads a fenced code block, with its content untouched, even if it is not closed yet', () => {
    expect(parseMarkdown('```js\nconst a = **1**;\n# not a heading\n```\nafter')).toEqual([{ type: 'code', lang: 'js', text: 'const a = **1**;\n# not a heading' }, para(t('after'))]);
    expect(parseMarkdown('```\nopen')).toEqual([{ type: 'code', lang: '', text: 'open' }]);
  });

  it('reads a block quote, with formatting and blocks inside', () => {
    expect(parseMarkdown('> **Note** this\n> second line')).toEqual([{ type: 'quote', blocks: [para(strong(t('Note')), t(' this'), { type: 'break' }, t('second line'))] }]);
  });
});

describe('parseMarkdown: lists', () => {
  const item = (children, blocks = []) => ({ children, blocks });

  it('reads bullet lists with -, * , + and •', () => {
    for (const marker of ['-', '*', '+', '•']) {
      expect(parseMarkdown(`${marker} a\n${marker} b`), marker).toEqual([{ type: 'list', ordered: false, start: 1, items: [item([t('a')]), item([t('b')])] }]);
    }
  });

  it('reads numbered lists, keeping the number they start from', () => {
    expect(parseMarkdown('1. a\n2. b')).toEqual([{ type: 'list', ordered: true, start: 1, items: [item([t('a')]), item([t('b')])] }]);
    expect(parseMarkdown('3) c\n4) d')).toEqual([{ type: 'list', ordered: true, start: 3, items: [item([t('c')]), item([t('d')])] }]);
  });

  it('reads a nested list by indentation', () => {
    expect(parseMarkdown('- a\n  - a1\n  - a2\n- b')).toEqual([
      { type: 'list', ordered: false, start: 1, items: [item([t('a')], [{ type: 'list', ordered: false, start: 1, items: [item([t('a1')]), item([t('a2')])] }]), item([t('b')])] },
    ]);
  });

  it('reads a numbered list with a bullet list inside it', () => {
    const [list] = parseMarkdown('1. Step one\n   - detail\n2. Step two');
    expect(list.ordered).toBe(true);
    expect(list.items[0].blocks[0]).toMatchObject({ type: 'list', ordered: false });
    expect(list.items).toHaveLength(2);
  });

  it('joins an indented continuation line to its item', () => {
    expect(parseMarkdown('- first line\n  more of it\n- next')).toEqual([{ type: 'list', ordered: false, start: 1, items: [item([t('first line'), { type: 'break' }, t('more of it')]), item([t('next')])] }]);
  });

  it('keeps a list together across blank lines between its items', () => {
    const blocks = parseMarkdown('- a\n\n- b');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].items).toHaveLength(2);
  });

  it('formats inline marks inside items, and does not mistake **bold** at the start of a line for a bullet', () => {
    expect(parseMarkdown('- **Label:** value')).toEqual([{ type: 'list', ordered: false, start: 1, items: [item([strong(t('Label:')), t(' value')])] }]);
    expect(parseMarkdown('**Label:** value')).toEqual([para(strong(t('Label:')), t(' value'))]);
  });

  it('starts a list right after a paragraph line, without a blank line', () => {
    const blocks = parseMarkdown('Intro:\n- a\n- b');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('ends a list at the next paragraph', () => {
    expect(parseMarkdown('- a\n\nplain').map((b) => b.type)).toEqual(['list', 'paragraph']);
  });

  it('does not read a number in a sentence as a list', () => {
    expect(parseMarkdown('2026. A good year')).toEqual([{ type: 'list', ordered: true, start: 2026, items: [item([t('A good year')])] }]);
    expect(parseMarkdown('The 5. item')).toEqual([para(t('The 5. item'))]);
    expect(parseMarkdown('-5 degrees')).toEqual([para(t('-5 degrees'))]);
  });
});

describe('parseMarkdown: tables', () => {
  const md = '| Product | Status |\n|---|:---:|\n| Neem oil | **Allowed** |\n| Kelp | Listed |';

  it('reads a table with its header, alignments and rows, with formatting in cells', () => {
    expect(parseMarkdown(md)).toEqual([{
      type: 'table',
      align: [null, 'center'],
      header: [[t('Product')], [t('Status')]],
      rows: [[[t('Neem oil')], [strong(t('Allowed'))]], [[t('Kelp')], [t('Listed')]]],
    }]);
  });

  it('reads left and right alignment', () => {
    const [table] = parseMarkdown('| a | b | c |\n|:--|--:|---|\n| 1 | 2 | 3 |');
    expect(table.align).toEqual(['left', 'right', null]);
  });

  it('reads a table without outer pipes', () => {
    const [table] = parseMarkdown('a | b\n--- | ---\n1 | 2');
    expect(table.type).toBe('table');
    expect(table.header).toEqual([[t('a')], [t('b')]]);
  });

  it('pads a short row and cuts a long one to the number of columns', () => {
    const [table] = parseMarkdown('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    expect(table.rows[0]).toEqual([[t('1')], []]);
    expect(table.rows[1]).toEqual([[t('1')], [t('2')]]);
  });

  it('keeps an escaped pipe inside a cell', () => {
    const [table] = parseMarkdown('| a | b |\n|---|---|\n| x \\| y | z |');
    expect(table.rows[0][0]).toEqual([t('x | y')]);
  });

  it('shows a table that is still arriving (header and separator only) as a table with no rows yet', () => {
    expect(parseMarkdown('| a | b |\n|---|---|')).toEqual([{ type: 'table', align: [null, null], header: [[t('a')], [t('b')]], rows: [] }]);
  });

  it('shows a header line with no separator yet as plain text', () => {
    expect(parseMarkdown('| a | b |')).toEqual([para(t('| a | b |'))]);
  });

  it('ends the table at the first blank line, and a paragraph can follow', () => {
    expect(parseMarkdown(`${md}\n\nafter`).map((b) => b.type)).toEqual(['table', 'paragraph']);
  });

  it('does not take a horizontal rule or a dash line under a paragraph for a table', () => {
    expect(parseMarkdown('text\n---')).toEqual([para(t('text')), { type: 'rule' }]);
  });
});

describe('parseMarkdown: a typical model answer', () => {
  it('turns a headed, listed, tabled answer into the right blocks in order', () => {
    const answer = [
      '## Assessment', '', 'Neem oil is **generally allowed** under §205.601(e).', '',
      '### Requirements', '', '- Keep the label', '- Record the *date*', '', '1. Check the OMRI listing', '2. Confirm with your certifier', '',
      '| Item | Result |', '|---|---|', '| Neem | Allowed |', '', '> Always confirm with your certifier.',
    ].join('\n');
    expect(parseMarkdown(answer).map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list', 'table', 'quote']);
  });

  it('never throws, and always gives an array, for any text at all', () => {
    const nasty = ['|', '||', '|---|', '> >', '- - -', '1.', '- ', '#', '```', '`', '**', '[', '](', '\\', '\n\n\n', '  - a\n- b\n    - c', '| a |\n|---|\n|\n|', '>' + '>'.repeat(50) + ' x', '- ' + 'a\n  - '.repeat(60)];
    for (const text of nasty) expect(Array.isArray(parseMarkdown(text)), JSON.stringify(text)).toBe(true);
  });

  it('copes with a very long answer', () => {
    const long = Array.from({ length: 3000 }, (_, i) => `- item **${i}** with *some* text`).join('\n');
    const started = Date.now();
    expect(parseMarkdown(long)[0].items).toHaveLength(3000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('does not change its input and gives a fresh result each time', () => {
    const input = '## A\n\n- b';
    const once = parseMarkdown(input);
    expect(parseMarkdown(input)).toEqual(once);
    expect(parseMarkdown(input)).not.toBe(once);
  });
});

describe('edge cases that must not change', () => {
  it('drops one space just inside a code span, and no more', () => {
    expect(parseInline('`` a ``')).toEqual([code('a')]);
    expect(parseInline('`  a  `')).toEqual([code(' a ')]);
    expect(parseInline('` `')).toEqual([code(' ')]);
  });

  it('does not nest a link inside a link label', () => {
    const nodes = parseInline('[see [inner](https://inner.org) here](https://outer.org)');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: 'link', href: 'https://outer.org' });
    expect(nodes[0].children).toEqual([t('see [inner](https://inner.org) here')]);
  });

  it('keeps a bracket that is escaped inside a link label', () => {
    expect(parseInline('[a\\]b](https://x.org)')).toEqual([{ type: 'link', href: 'https://x.org', children: [t('a]b')] }]);
  });

  it('leaves empty or blank link targets as text', () => {
    expect(parseInline('[b]( )')).toEqual([t('[b]( )')]);
  });

  it('copes with a link address that holds parentheses', () => {
    expect(parseInline('[w](https://en.wikipedia.org/wiki/Organic_(food))')).toEqual([{ type: 'link', href: 'https://en.wikipedia.org/wiki/Organic_(food)', children: [t('w')] }]);
  });

  it('does not let a deeply nested quote overflow the stack', () => {
    const blocks = parseMarkdown(`${'>'.repeat(20000)} deep`);
    expect(blocks).toHaveLength(1);
    expect(JSON.stringify(blocks)).toContain('deep');
  });

  it('does not let a deeply nested list overflow the stack', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `${' '.repeat(i * 2)}- level ${i}`).join('\n');
    expect(JSON.stringify(parseMarkdown(text))).toContain('level 2999');
  });

  it('closes a code fence only with a fence at least as long as the opening one', () => {
    expect(parseMarkdown('````\n```\nstill code\n````\nafter')).toEqual([{ type: 'code', lang: '', text: '```\nstill code' }, para(t('after'))]);
  });

  it('closes a ~~~ fence only with ~~~', () => {
    expect(parseMarkdown('~~~\n```\n~~~')).toEqual([{ type: 'code', lang: '', text: '```' }]);
  });

  it('takes a header and separator with different column counts for plain text', () => {
    expect(parseMarkdown('| a | b | c |\n|---|---|').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('ends a table at the first line without a pipe', () => {
    const blocks = parseMarkdown('| a |\n|---|\n| 1 |\nplain words');
    expect(blocks.map((b) => b.type)).toEqual(['table', 'paragraph']);
    expect(blocks[0].rows).toHaveLength(1);
  });

  it('does not take an escaped closing pipe for the end of the row', () => {
    const [table] = parseMarkdown('| a | b |\n|---|---|\n| x | y \\|');
    expect(table.rows[0]).toEqual([[t('x')], [t('y |')]]);
  });

  it('lets a list that starts at 1 interrupt a paragraph, but not one that starts elsewhere', () => {
    expect(parseMarkdown('Steps:\n1. a').map((b) => b.type)).toEqual(['paragraph', 'list']);
    expect(parseMarkdown('Steps:\n2. a').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('does not let an empty bullet interrupt a paragraph', () => {
    expect(parseMarkdown('Intro\n-').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('reads a tab-indented sub-list as nested', () => {
    const [list] = parseMarkdown('- a\n\t- b');
    expect(list.items).toHaveLength(1);
    expect(list.items[0].blocks[0]).toMatchObject({ type: 'list' });
  });

  it('reads a lone carriage return as a line break', () => {
    expect(parseMarkdown('a\r\rb')).toEqual([para(t('a')), para(t('b'))]);
  });

  it('keeps a list item that is only a nested list', () => {
    const [list] = parseMarkdown('-\n  - inner');
    expect(list.items[0].children).toEqual([]);
    expect(list.items[0].blocks[0]).toMatchObject({ type: 'list' });
  });

  it('does not take a paragraph line that starts with a hash and no space for a heading', () => {
    expect(parseMarkdown('Some text\n#nospace').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('puts a heading in the middle of a paragraph block', () => {
    expect(parseMarkdown('text\n## Head').map((b) => b.type)).toEqual(['paragraph', 'heading']);
  });
});

describe('emphasis rules from the CommonMark spec', () => {
  it('lets * work inside a word, as the spec says', () => {
    expect(parseInline('un*frigging*believable')).toEqual([t('un'), em(t('frigging')), t('believable')]);
  });

  it('does not let _ open or close inside a word', () => {
    expect(parseInline('snake_case_ x')).toEqual([t('snake_case_ x')]);
    expect(parseInline('_snake_case')).toEqual([t('_snake_case')]);
  });

  it('does not open emphasis after a letter when punctuation follows, or close it before a letter', () => {
    expect(parseInline('a**(b)**')).toEqual([t('a**(b)**')]);
    expect(parseInline('**(b)**c')).toEqual([t('**(b)**c')]);
  });

  it('does not pair a * with a _', () => {
    expect(parseInline('*foo_')).toEqual([t('*foo_')]);
    expect(parseInline('_foo*')).toEqual([t('_foo*')]);
  });

  it('does not let a mark that can only close open emphasis', () => {
    expect(parseInline('a* b*')).toEqual([t('a* b*')]);
  });

  it('applies the multiple-of-three rule, and its exception', () => {
    expect(parseInline('*foo**bar*')).toEqual([em(t('foo**bar'))]);
    expect(parseInline('foo***bar***baz')).toEqual([t('foo'), em(strong(t('bar'))), t('baz')]);
  });

  it('reads nested emphasis of the same kind apart', () => {
    expect(parseInline('**a** and **b**')).toEqual([strong(t('a')), t(' and '), strong(t('b'))]);
    expect(parseInline('*a* b *c*')).toEqual([em(t('a')), t(' b '), em(t('c'))]);
  });
});

describe('details of code, links and markers', () => {
  it('takes a space off both sides of a code span, never one side, and never from blanks', () => {
    expect(parseInline('` a`')).toEqual([code(' a')]);
    expect(parseInline('`a `')).toEqual([code('a ')]);
    expect(parseInline('`   `')).toEqual([code('   ')]);
  });

  it('closes a code span only with a run of the same length', () => {
    expect(parseInline('`a``b`')).toEqual([code('a``b')]);
  });

  it('trims the words of a [NEEDS OPERATOR INPUT: …] marker', () => {
    expect(parseInline('[NEEDS OPERATOR INPUT:   your name  ]')).toEqual([{ type: 'marker', text: 'your name' }]);
  });

  it('accepts a link scheme in any case', () => {
    expect(parseInline('[a](HTTPS://X.ORG)')).toEqual([{ type: 'link', href: 'HTTPS://X.ORG', children: [t('a')] }]);
    expect(parseInline('[a](MAILTO:a@b.org)')).toEqual([{ type: 'link', href: 'MAILTO:a@b.org', children: [t('a')] }]);
  });

  it('gives nothing but text for input that is not a string', () => {
    for (const odd of [undefined, null, 5, {}]) expect(parseInline(odd)).toEqual([]);
  });
});

describe('block details that must not change', () => {
  it('takes the fence’s own indentation off the code lines', () => {
    expect(parseMarkdown('  ```\n  a\n   b\n  ```')).toEqual([{ type: 'code', lang: '', text: 'a\n b' }]);
  });

  it('needs three marks for a rule', () => {
    expect(parseMarkdown('--').map((b) => b.type)).toEqual(['paragraph']);
    expect(parseMarkdown('**').map((b) => b.type)).toEqual(['paragraph']);
    expect(parseMarkdown('- -').map((b) => b.type)).toEqual(['list']);
  });

  it('keeps an item that is indented by one space in the same list', () => {
    const [list] = parseMarkdown('- a\n - b');
    expect(list.items).toHaveLength(2);
  });

  it('starts a new list when the kind of list changes, with or without a blank line', () => {
    expect(parseMarkdown('1. a\n- b').map((b) => [b.type, b.ordered])).toEqual([['list', true], ['list', false]]);
    expect(parseMarkdown('- a\n\n1. b').map((b) => [b.type, b.ordered])).toEqual([['list', false], ['list', true]]);
  });

  it('keeps a blank line between two paragraphs inside one item', () => {
    const [list] = parseMarkdown('- a\n\n  b');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toEqual({ children: [t('a')], blocks: [para(t('b'))] });
  });

  it('lets a fence or a quote interrupt a paragraph', () => {
    expect(parseMarkdown('text\n```\ncode\n```').map((b) => b.type)).toEqual(['paragraph', 'code']);
    expect(parseMarkdown('text\n> quoted').map((b) => b.type)).toEqual(['paragraph', 'quote']);
  });

  it('lets a table interrupt a paragraph', () => {
    expect(parseMarkdown('Intro\n| a |\n|---|\n| 1 |').map((b) => b.type)).toEqual(['paragraph', 'table']);
  });

  it('does not take a pipeless header or separator for a table', () => {
    expect(parseMarkdown('a\n|---|').map((b) => b.type)).toEqual(['paragraph']);
    expect(parseMarkdown('| a |\n---').map((b) => b.type)).toEqual(['paragraph', 'rule']);
    expect(parseMarkdown('| a | b |\n| x | y |').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('reads a list number of at most nine digits', () => {
    expect(parseMarkdown('123456789. a')[0]).toMatchObject({ type: 'list', start: 123456789 });
    expect(parseMarkdown('1234567890. a').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('takes the leading spaces off every line of a paragraph', () => {
    expect(parseMarkdown('   a\n   b')).toEqual([para(t('a'), { type: 'break' }, t('b'))]);
  });
});

describe('content inside list items', () => {
  it('reads a code block inside a nested item', () => {
    const [list] = parseMarkdown('- a\n  - b\n    ```\n    code\n    ```');
    const inner = list.items[0].blocks[0];
    expect(inner.items[0].blocks).toEqual([{ type: 'code', lang: '', text: 'code' }]);
  });

  it('reads a table inside an item', () => {
    const [list] = parseMarkdown('1. Review:\n   | a | b |\n   |---|---|\n   | 1 | 2 |');
    expect(list.items[0].blocks[0]).toMatchObject({ type: 'table' });
  });

  it('keeps items together when the indentation wobbles by a space or two', () => {
    const [list, ...rest] = parseMarkdown('- a\n - b\n  - c');
    expect(rest).toEqual([]);
    expect(list.items.length).toBeGreaterThanOrEqual(2);
  });
});
