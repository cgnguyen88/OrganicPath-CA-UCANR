// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import AiText from './AiText.jsx';

afterEach(cleanup);

describe('AiText: structure', () => {
  it('renders nothing for empty or missing text', () => {
    const { container } = render(<AiText text="" />);
    expect(container.firstChild).toBeNull();
    cleanup();
    expect(render(<AiText />).container.firstChild).toBeNull();
  });

  it('shows markdown headings as real headings, one level below the page title', () => {
    render(<AiText text={'# One\n\n## Two\n\n### Three'} />);
    expect(screen.getByRole('heading', { level: 2, name: 'One' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Two' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Three' })).toBeTruthy();
  });

  it('shows no markdown marks on screen', () => {
    const { container } = render(<AiText text={'## Soil\n\n**Label:** *value* and `code`\n\n- a\n- b'} />);
    expect(container.textContent).not.toMatch(/[#*`]/);
    expect(container.textContent).not.toMatch(/^\s*-\s/m);
  });

  it('shows bold, italic and code as semantic elements', () => {
    const { container } = render(<AiText text="A **bold**, *italic* and `code` word." />);
    expect(container.querySelector('strong').textContent).toBe('bold');
    expect(container.querySelector('em').textContent).toBe('italic');
    expect(container.querySelector('code').textContent).toBe('code');
  });

  it('shows bullet and numbered lists as lists, nested ones inside their item', () => {
    const { container } = render(<AiText text={'- a\n  - a1\n- b\n\n3. c\n4. d'} />);
    const lists = container.querySelectorAll('ul, ol');
    expect(lists).toHaveLength(3);
    expect(container.querySelector('ul ul li').textContent).toBe('a1');
    expect(container.querySelector('ol').getAttribute('start')).toBe('3');
    expect(within(container.querySelector('ol')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows a table with column headers and the alignment it asked for', () => {
    const { container } = render(<AiText text={'| Item | Qty |\n|:--|--:|\n| Kelp | **4** |'} />);
    const heads = container.querySelectorAll('th');
    expect([...heads].map((h) => h.textContent)).toEqual(['Item', 'Qty']);
    expect(heads[0].getAttribute('scope')).toBe('col');
    expect(heads[1].style.textAlign).toBe('right');
    expect(container.querySelector('td strong').textContent).toBe('4');
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows a quote, a rule and a code block', () => {
    const { container } = render(<AiText text={'> Always confirm.\n\n---\n\n```\nx = 1\n```'} />);
    expect(container.querySelector('blockquote').textContent).toBe('Always confirm.');
    expect(container.querySelector('hr')).toBeTruthy();
    expect(container.querySelector('pre code').textContent).toBe('x = 1');
  });

  it('keeps single line breaks inside a paragraph', () => {
    const { container } = render(<AiText text={'one\ntwo'} />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('br')).toBeTruthy();
  });

  it('shows the [NEEDS OPERATOR INPUT: …] marker as a highlighted badge', () => {
    render(<AiText text="Name: [NEEDS OPERATOR INPUT: legal name]" />);
    const badge = screen.getByText(/NEEDS INPUT/);
    expect(badge.textContent).toContain('legal name');
    expect(badge.textContent).not.toContain('[');
  });
});

describe('AiText: safety', () => {
  it('shows HTML in the text as text and never as elements', () => {
    const { container } = render(<AiText text={'<script>window.__x=1</script> <img src=x onerror="window.__x=1"> <b>hi</b>'} />);
    expect(container.querySelector('script, img, b')).toBeNull();
    expect(container.textContent).toContain('<script>');
    expect(window.__x).toBeUndefined();
  });

  it('makes a link of an https address, opened safely in a new tab', () => {
    render(<AiText text="see [CDFA](https://www.cdfa.ca.gov/)" />);
    const link = screen.getByRole('link', { name: 'CDFA' });
    expect(link.getAttribute('href')).toBe('https://www.cdfa.ca.gov/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example'])('makes no link of %s', (href) => {
    const { container } = render(<AiText text={`[click](${href})`} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('click');
  });

  it('survives text that is not a string', () => {
    for (const bad of [5, {}, [], true]) {
      const { container } = render(<AiText text={bad} />);
      expect(container.firstChild).toBeNull();
      cleanup();
    }
  });
});

describe('AiText: variants', () => {
  it('has a document look and a more compact chat look', () => {
    const doc = render(<AiText text="Hello" variant="document" />).container.firstChild;
    cleanup();
    const chat = render(<AiText text="Hello" variant="chat" />).container.firstChild;
    expect(doc.getAttribute('data-variant')).toBe('document');
    expect(chat.getAttribute('data-variant')).toBe('chat');
    expect(parseFloat(chat.style.fontSize)).toBeLessThan(parseFloat(doc.style.fontSize));
  });

  it('shows a headings inside a chat bubble without the page-level heading size', () => {
    render(<AiText text="# Big" variant="chat" />);
    const h = screen.getByRole('heading', { name: 'Big' });
    expect(parseFloat(h.style.fontSize)).toBeLessThanOrEqual(15);
  });
});

describe('AiText: spacing and fallbacks', () => {
  it('takes the top margin off the first block only, so the text sits flush in its box', () => {
    render(<AiText text={'## First heading\n\nA paragraph\n\n## Second heading'} />);
    expect(screen.getByRole('heading', { name: 'First heading' }).style.marginTop).toBe('0px');
    expect(screen.getByRole('heading', { name: 'Second heading' }).style.marginTop).not.toBe('0px');
  });

  it('takes the top margin off a first paragraph and a first list too', () => {
    const { container } = render(<AiText text="First paragraph" />);
    expect(container.querySelector('p').style.marginTop).toBe('0px');
    cleanup();
    const list = render(<AiText text={'- one\n- two'} />).container;
    expect(list.querySelector('ul').style.marginTop).toBe('0px');
  });

  it('uses the document look for an unknown variant', () => {
    const { container } = render(<AiText text="x" variant="weird" />);
    expect(container.firstChild.getAttribute('data-variant')).toBe('document');
  });

  it('gives a nested list and a paragraph in an item less space above them', () => {
    const { container } = render(<AiText text={'- a\n  - b\n\n  more text'} />);
    expect(container.querySelector('ul ul').style.marginTop).toBe('4px');
    expect(container.querySelector('li p').style.marginTop).toBe('4px');
  });

  it('numbers an ordered list from where it starts, and not from one', () => {
    const { container } = render(<AiText text={'1. a\n2. b'} />);
    expect(container.querySelector('ol').hasAttribute('start')).toBe(false);
  });

  it('shows the cells of a ragged table without breaking', () => {
    const { container } = render(<AiText text={'| a | b |\n|---|---|\n| 1 |'} />);
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('shows a heading of any depth, down to the smallest', () => {
    render(<AiText text={'# Top\n\n###### Deep'} />);
    expect(screen.getByRole('heading', { level: 6, name: 'Deep' })).toBeTruthy();
  });

  it('shows a chat heading as a small heading below the page headings', () => {
    render(<AiText text={'# A\n\n### B\n\n###### C'} variant="chat" />);
    expect(screen.getByRole('heading', { name: 'A' }).tagName).toBe('H4');
    expect(screen.getByRole('heading', { name: 'B' }).tagName).toBe('H6');
    expect(screen.getByRole('heading', { name: 'C' }).tagName).toBe('H6');
  });

  it('makes a heading smaller the deeper it is', () => {
    render(<AiText text={'# One\n\n## Two\n\n### Three\n\n#### Four'} />);
    const sizes = ['One', 'Two', 'Three', 'Four'].map((name) => parseFloat(screen.getByRole('heading', { name }).style.fontSize));
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
    expect(sizes[2]).toBeGreaterThanOrEqual(sizes[3]);
  });

  it('tints every second row of a table, so long rows are easy to follow', () => {
    const { container } = render(<AiText text={'| a |\n|---|\n| 1 |\n| 2 |\n| 3 |'} />);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.style.background !== '')).toEqual([false, true, false]);
  });
});

describe('AiText: heading levels follow the page', () => {
  it('puts the top heading of the text one level below the page title, whatever number of # it was written with', () => {
    render(<AiText text={'## First\n\n### Second'} />);
    expect(screen.getByRole('heading', { level: 2, name: 'First' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Second' })).toBeTruthy();
  });

  it('starts the headings lower when the text sits under a heading of its own', () => {
    render(<AiText text={'## First\n\n### Second'} headingStart={5} />);
    expect(screen.getByRole('heading', { level: 5, name: 'First' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 6, name: 'Second' })).toBeTruthy();
  });

  it('never goes below the smallest heading', () => {
    render(<AiText text={'# A\n\n## B\n\n### C'} headingStart={6} />);
    for (const name of ['A', 'B', 'C']) expect(screen.getByRole('heading', { level: 6, name })).toBeTruthy();
  });

  it('keeps the look of a heading by how it was written, not by where it sits', () => {
    render(<AiText text={'## Section'} headingStart={5} />);
    const sectionSize = parseFloat(screen.getByRole('heading', { name: 'Section' }).style.fontSize);
    cleanup();
    render(<AiText text={'# Title'} headingStart={5} />);
    expect(parseFloat(screen.getByRole('heading', { name: 'Title' }).style.fontSize)).toBeGreaterThan(sectionSize);
  });

  it('starts chat headings at h4 by default', () => {
    render(<AiText text={'## Small'} variant="chat" />);
    expect(screen.getByRole('heading', { level: 4, name: 'Small' })).toBeTruthy();
  });
});

describe('AiText: edges, checklists and links', () => {
  it('takes the bottom margin off the last block, so a bubble is not bottom-heavy', () => {
    const { container } = render(<AiText text={'First\n\nLast paragraph'} />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs[0].style.marginBottom).not.toBe('0px');
    expect(paragraphs[1].style.marginBottom).toBe('0px');
  });

  it('takes the bottom margin off a last list and a last table', () => {
    expect(render(<AiText text={'- a\n- b'} />).container.querySelector('ul').style.marginBottom).toBe('0px');
    cleanup();
    expect(render(<AiText text={'| a |\n|---|\n| 1 |'} />).container.firstChild.firstChild.style.marginBottom).toBe('0px');
  });

  it('draws a checklist with boxes in place of bullets', () => {
    const { container } = render(<AiText text={'- [ ] Check logs\n- [x] Sign form'} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['\u2610 Check logs', '\u2611 Sign form']);
    expect(items[0].style.listStyleType || items[0].style.listStyle).toMatch(/none/);
    expect(container.querySelector('li span[aria-hidden="true"]').textContent.trim()).toBe('\u2610');
  });

  it('keeps an ordinary list as bullets', () => {
    render(<AiText text={'- a\n- b'} />);
    expect(screen.getAllByRole('listitem')[0].style.listStyle).not.toMatch(/none/);
  });

  it('shows where a link goes when the pointer rests on it', () => {
    render(<AiText text="[CDFA](https://www.cdfa.ca.gov/)" />);
    expect(screen.getByRole('link', { name: 'CDFA' }).getAttribute('title')).toBe('https://www.cdfa.ca.gov/');
  });

  it('shows the real address of a link that claimed to be another site', () => {
    render(<AiText text="[https://cdfa.ca.gov](https://evil.example/x)" />);
    expect(screen.getByRole('link').textContent).toBe('https://evil.example/x');
  });

  it('does not take an inherited name for a variant', () => {
    const { container } = render(<AiText text="x" variant="constructor" />);
    expect(container.firstChild.getAttribute('data-variant')).toBe('document');
  });

  it('never makes a heading level below one, even for a heading nested above the text’s top heading', () => {
    render(<AiText text={'### Top\n\n> # Inside a quote'} headingStart={1} />);
    expect(screen.getAllByRole('heading')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Inside a quote' }).tagName).toBe('H1');
  });
});

