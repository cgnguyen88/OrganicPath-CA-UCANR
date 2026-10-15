import { describe, it, expect } from 'vitest';
import { markdownToPlainText } from './plain.js';

describe('markdownToPlainText', () => {
  it('gives an empty string for empty or non-text input', () => {
    for (const v of ['', '   ', null, undefined, 4, {}]) expect(markdownToPlainText(v)).toBe('');
  });

  it('drops the markup marks and keeps the words', () => {
    expect(markdownToPlainText('A **bold**, *italic* and `code` word.')).toBe('A bold, italic and code word.');
  });

  it('does not add the section signs, hashes or asterisks of the markup', () => {
    const out = markdownToPlainText('## Heading\n\n**Label:** value');
    expect(out).toBe('Heading\n\nLabel: value');
    expect(out).not.toMatch(/[#*]/);
  });

  it('keeps legal references such as §205.601(e) untouched', () => {
    expect(markdownToPlainText('See §205.601(e) and 7 CFR §205.202.')).toBe('See §205.601(e) and 7 CFR §205.202.');
  });

  it('separates blocks with one blank line', () => {
    expect(markdownToPlainText('# Title\n\nOne.\n\n\n\nTwo.')).toBe('Title\n\nOne.\n\nTwo.');
  });

  it('keeps single line breaks inside a paragraph', () => {
    expect(markdownToPlainText('line one\nline two')).toBe('line one\nline two');
  });

  it('writes bullet lists with a bullet character, one item per line', () => {
    expect(markdownToPlainText('- a\n- b\n- c')).toBe('• a\n• b\n• c');
  });

  it('writes numbered lists with their numbers, counting from where they start', () => {
    expect(markdownToPlainText('1. a\n2. b')).toBe('1. a\n2. b');
    expect(markdownToPlainText('3. a\n7. b')).toBe('3. a\n4. b');
  });

  it('indents nested lists under their item', () => {
    expect(markdownToPlainText('- a\n  - a1\n  - a2\n- b')).toBe('• a\n  • a1\n  • a2\n• b');
  });

  it('writes a table as tab-separated rows, so it pastes into a spreadsheet or a Word table', () => {
    expect(markdownToPlainText('| Item | Result |\n|---|---|\n| Neem | **Allowed** |\n| Kelp | Listed |')).toBe('Item\tResult\nNeem\tAllowed\nKelp\tListed');
  });

  it('writes a link as its words followed by the address, and only once when they are the same', () => {
    expect(markdownToPlainText('see [CDFA](https://www.cdfa.ca.gov/)')).toBe('see CDFA (https://www.cdfa.ca.gov/)');
    expect(markdownToPlainText('[https://x.org](https://x.org)')).toBe('https://x.org');
  });

  it('writes only the words for a link that is not safe', () => {
    expect(markdownToPlainText('[click](javascript:alert(1))')).toBe('click');
  });

  it('keeps the [NEEDS OPERATOR INPUT: …] marker so the farmer can still find the gap', () => {
    expect(markdownToPlainText('Name: [NEEDS OPERATOR INPUT: legal name]')).toBe('Name: [NEEDS OPERATOR INPUT: legal name]');
  });

  it('indents a quote and writes a rule as a line', () => {
    expect(markdownToPlainText('> Always confirm.')).toBe('  Always confirm.');
    expect(markdownToPlainText('a\n\n---\n\nb')).toMatch(/^a\n\n-{10,}\n\nb$/);
  });

  it('keeps a code block exactly as written', () => {
    expect(markdownToPlainText('```\nx = **1**\n```')).toBe('x = **1**');
  });

  it('does not change text that has no markup', () => {
    const plain = 'Dear certifier,\n\nPlease find the records attached.';
    expect(markdownToPlainText(plain)).toBe(plain);
  });

  it('lines up the second line of an item under its first', () => {
    expect(markdownToPlainText('- first\n  second')).toBe('\u2022 first\n  second');
    expect(markdownToPlainText('1. first\n   second')).toBe('1. first\n   second');
  });

  it('writes a nested list under an item that has no text of its own', () => {
    expect(markdownToPlainText('-\n  - inner')).toBe('\u2022 \n  \u2022 inner');
  });

  it('writes a quote around several paragraphs', () => {
    expect(markdownToPlainText('> one\n>\n> two')).toBe('  one\n\n  two');
  });

  it('leaves out a block that has no text, with no stray blank lines', () => {
    expect(markdownToPlainText('#\n\ntext')).toBe('text');
  });

  it('writes a checklist with boxes', () => {
    expect(markdownToPlainText('- [ ] Check logs\n- [x] Sign form')).toBe('\u2610 Check logs\n\u2611 Sign form');
  });

  it('keeps a table cell on one line, so a row stays a row', () => {
    expect(markdownToPlainText('| a | b |\n|---|---|\n| x<br>y | z |')).toBe('a\tb\nx y\tz');
  });

  it('keeps a cell that starts like a spreadsheet formula from running when it is pasted into a sheet', () => {
    const table = (cell) => `| h |\n|---|\n| ${cell} |`;
    expect(markdownToPlainText(table('=HYPERLINK("http://x.org")'))).toBe("h\n'=HYPERLINK(\"http://x.org\")");
    expect(markdownToPlainText(table('@SUM(A1)'))).toBe("h\n'@SUM(A1)");
    expect(markdownToPlainText(table('+1+cmd'))).toBe("h\n'+1+cmd");
    expect(markdownToPlainText(table('-cmd'))).toBe("h\n'-cmd");
    expect(markdownToPlainText('| =bad |\n|---|\n| ok |')).toBe("'=bad\nok");
  });

  it('leaves numbers, a lone dash and an ordinary dash alone in a table', () => {
    for (const cell of ['-5', '+3.5', '-1,200', '12%', '-', '- note', 'plain']) {
      expect(markdownToPlainText(`| h |\n|---|\n| ${cell} |`)).toBe(`h\n${cell}`);
    }
  });

  it('does not stop on text nested more deeply than it will read', () => {
    expect(markdownToPlainText(`${'*a '.repeat(3000)}x${'* '.repeat(3000)}`)).toContain('x');
  });
});

