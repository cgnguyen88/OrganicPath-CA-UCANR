import { describe, it, expect } from 'vitest';
import { parseEcfrPart, MAX_CHUNK_CHARS } from './parse.js';

// SYNTHETIC document in the eCFR XML shape (DIV8 sections made of <P> paragraphs). Not regulation text.
const section = (n, head, body) => `<DIV8 N="${n}" TYPE="SECTION" hierarchy_metadata="{&quot;x&quot;:1}">\n<HEAD>&#xA7; ${n} ${head}</HEAD>\n${body}\n</DIV8>`;
const wrap = (...sections) => `<?xml version="1.0"?>\n<DIV5 N="205" TYPE="PART"><HEAD>PART 205</HEAD><DIV6 N="A" TYPE="SUBPART"><HEAD>Subpart A</HEAD>${sections.join('\n')}</DIV6></DIV5>`;
const parse = (xml) => parseEcfrPart(xml, { versionDate: '2026-10-08' });

const SAMPLE = wrap(
  section('205.900', 'Test definitions.', '<P>Intro with <I>italic</I> &amp; entities &#x2014; ok.</P>\n<P>(a) First lettered item.</P>\n<P>(1) Nested one.</P>\n<P>(i) Roman one.</P>\n<P>(ii) Roman two.</P>\n<P>(2) Nested two.</P>\n<P>(b) Second lettered item.</P>\n<CITA>[65 FR 1, Jan. 1, 2000]</CITA>'),
  section('205.901', '[Reserved]', ''),
  section('205.902', 'Plain section.', '<P>Just one paragraph, no markers.</P>'),
);

describe('parseEcfrPart', () => {
  const rows = parse(SAMPLE);

  it('makes one chunk per top-level paragraph group, plus the intro, and skips empty sections', () => {
    expect(rows.map((r) => r.anchor)).toEqual(['205.900', '205.900(a)', '205.900(b)', '205.902']);
    expect(rows.some((r) => r.section === '205.901')).toBe(false);
  });

  it('fills every column the table needs', () => {
    expect(rows[1]).toMatchObject({
      title_number: 7, part: '205', section: '205.900', anchor: '205.900(a)', citation: '7 CFR 205.900(a)',
      heading: 'Test definitions.', version_date: '2026-10-08', source_url: 'https://www.ecfr.gov/current/title-7/section-205.900',
    });
    expect(rows.map((r) => r.ord)).toEqual([1, 2, 3, 1]);
  });

  it('keeps nested items inside their lettered group, in order', () => {
    expect(rows[1].body).toBe('(a) First lettered item.\n(1) Nested one.\n(i) Roman one.\n(ii) Roman two.\n(2) Nested two.');
  });

  it('strips tags, decodes entities, and drops amendment citations', () => {
    expect(rows[0].body).toBe('Intro with italic & entities — ok.');
    expect(rows.map((r) => r.body).join('')).not.toMatch(/FR 1|<|&#/);
  });

  it('treats a lone (i) as the next letter, not a roman numeral, unless (ii) follows', () => {
    const xml = wrap(section('205.910', 'Letters.', '<P>(h) Eighth.</P>\n<P>(1) Sub.</P>\n<P>(i) Ninth letter item.</P>\n<P>(1) Its sub.</P>\n<P>(j) Tenth.</P>'));
    expect(parse(xml).map((r) => r.anchor)).toEqual(['205.910(h)', '205.910(i)', '205.910(j)']);
    const roman = wrap(section('205.911', 'Roman.', '<P>(h) Eighth.</P>\n<P>(1) Sub.</P>\n<P>(i) Roman one.</P>\n<P>(ii) Roman two.</P>\n<P>(i) Ninth letter.</P>'));
    expect(parse(roman).map((r) => r.anchor)).toEqual(['205.911(h)', '205.911(i)']);
    expect(parse(roman)[0].body).toContain('(ii) Roman two.');
  });

  it('splits an oversized group at paragraph boundaries, with unique citations that start at real paragraphs', () => {
    const para = (marker) => `<P>${marker} ${'word '.repeat(150)}</P>`;
    const items = ['(a) Big group.', ...Array.from({ length: 12 }, (_, i) => `(${i + 1}) ${'word '.repeat(150)}`)].map((t, i) => (i === 0 ? `<P>${t}</P>` : `<P>${t}</P>`)).join('\n');
    const big = parse(wrap(section('205.920', 'Big.', items)));
    expect(big.length).toBeGreaterThan(1);
    for (const r of big) expect(r.body.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + 600);
    expect(new Set(big.map((r) => r.citation)).size).toBe(big.length);
    expect(big[1].anchor).toMatch(/^205\.920\(a\)\(\d+\)$/);
    expect(para('(a)')).toBeTruthy();
  });

  it('labels chunks that share a paragraph marker by their opening words, not by a counter', () => {
    const def = (term) => `<P>${term}. ${'A long definition of the term, in words. '.repeat(30)}</P>`;
    const defs = ['Alpha term', 'Beta term', 'Gamma term', 'Delta term'].map(def).join('\n');
    const out = parse(wrap(section('205.940', 'Terms defined.', `<P>(a) Intro.</P>\n${defs}`)));
    expect(out.length).toBeGreaterThan(1);
    const citations = out.map((r) => r.citation);
    expect(new Set(citations).size).toBe(citations.length);
    expect(citations.join('|')).toMatch(/Beta term|Gamma term|Delta term/);
    expect(citations.join('|')).not.toMatch(/cont\./);
    for (const c of citations) expect(c).toMatch(/^7 CFR 205\.940/);
  });

  it('hard-splits a single paragraph longer than the database limit', () => {
    const huge = wrap(section('205.930', 'Huge.', `<P>${'longword '.repeat(1500)}</P>`));
    const out = parse(huge);
    expect(out.length).toBeGreaterThan(1);
    for (const r of out) expect(r.body.length).toBeLessThanOrEqual(8000);
    expect(new Set(out.map((r) => r.citation)).size).toBe(out.length);
  });

  it('rejects a document with no sections, and bad dates', () => {
    expect(() => parse('<DIV5 N="205" TYPE="PART"></DIV5>')).toThrow(/no sections/i);
    expect(() => parseEcfrPart(SAMPLE, { versionDate: 'yesterday' })).toThrow(/version date/i);
  });
});
