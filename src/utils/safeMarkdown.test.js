import { describe, it, expect } from 'vitest';
import { escapeHtml, renderChatMarkdown, renderOspInline } from './safeMarkdown.js';

const XSS_PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '<svg onload=alert(1)>',
  '"><iframe src="javascript:alert(1)"></iframe>',
  "<a href='javascript:alert(1)'>x</a>",
  '**<img src=x onerror=alert(1)>**',
  '*<script>alert(1)</script>*',
  '[NEEDS OPERATOR INPUT:<img src=x onerror=alert(1)>]',
];

// Any tag we emit must be one of ours; a raw model-supplied tag must never survive.
const ALLOWED_TAGS = /^(strong|em|br|span)$/;
function emittedTags(html) {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('does not touch plain text and handles non-strings safely', () => {
    expect(escapeHtml('Compost 50 lb')).toBe('Compost 50 lb');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});

describe.each([
  ['renderChatMarkdown', renderChatMarkdown],
  ['renderOspInline', renderOspInline],
])('%s', (_name, render) => {
  it.each(XSS_PAYLOADS)('neutralizes %j', (payload) => {
    const html = render(payload);
    for (const tag of emittedTags(html)) expect(tag, html).toMatch(ALLOWED_TAGS);
    expect(html).not.toMatch(/<\s*(img|script|svg|iframe|a)\b/i);
  });

  it('still renders bold and italic', () => {
    expect(render('a **bold** and *italic* b')).toBe('a <strong>bold</strong> and <em>italic</em> b');
  });

  it('keeps ordinary punctuation readable', () => {
    expect(render('Q&A: 5 < 10 > 3')).toBe('Q&amp;A: 5 &lt; 10 &gt; 3');
  });
});

describe('renderChatMarkdown', () => {
  it('turns newlines into <br/>', () => {
    expect(renderChatMarkdown('line1\nline2')).toBe('line1<br/>line2');
  });
});

describe('renderOspInline', () => {
  it('renders the NEEDS OPERATOR INPUT badge with escaped content', () => {
    const html = renderOspInline('x [NEEDS OPERATOR INPUT: crop list] y');
    expect(html).toContain('NEEDS INPUT:');
    expect(html).toContain(' crop list');
    expect(html).toContain('<span style="');
  });
});
