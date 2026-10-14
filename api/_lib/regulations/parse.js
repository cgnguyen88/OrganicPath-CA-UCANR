/**
 * Turn the eCFR XML for one CFR part into paragraph-anchored chunks for the
 * `regulation_chunks` table. Pure and dependency-free: the eCFR structure is regular
 * (<DIV8 TYPE="SECTION"> containing <HEAD> and flat <P> paragraphs with inline tags).
 *
 * Chunks follow the regulation's own lettered paragraphs, e.g. (a) with everything nested under
 * it, so an answer can cite "7 CFR 205.601(a)" instead of a whole 38,000-character section.
 */

/** Target size of a chunk. The table allows 8000; smaller chunks retrieve better. */
export const MAX_CHUNK_CHARS = 3500;
const TITLE_NUMBER = 7;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Text of an XML fragment: inline tags removed, entities decoded, whitespace collapsed. */
const plainText = (fragment) => decodeEntities(fragment.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const successorOf = (letter) => (letter === null ? 'a' : String.fromCharCode(letter.charCodeAt(0) + 1));
const markerOf = (paragraph) => /^\(([A-Za-z0-9]+)\)/.exec(paragraph)?.[1] ?? null;

/**
 * Nesting level of a paragraph marker: 1 (a), 2 (1), 3 (i), 4 (A). Letters are level 1 when they
 * are the next letter in the sequence; a lone "(i)" followed by "(ii)" is a roman numeral instead.
 */
function levelOf(marker, nextMarker, lastLevelOne) {
  if (/^[a-z]$/.test(marker) && marker === successorOf(lastLevelOne) && !(marker === 'i' && nextMarker === 'ii')) return 1;
  if (/^\d+$/.test(marker)) return 2;
  if (/^[ivxlc]+$/.test(marker)) return 3;
  if (/^[A-Z]+$/.test(marker)) return 4;
  if (/^[a-z]$/.test(marker)) return 1;
  return null;
}

/** Break text longer than `limit` into pieces at spaces. */
function splitLongText(text, limit) {
  const pieces = [];
  let rest = text;
  while (rest.length > limit) {
    const cut = rest.lastIndexOf(' ', limit);
    const at = cut > limit / 2 ? cut : limit;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Paragraphs of one section with the anchor each one sits at and whether it opens a (a)-level group. */
function annotateParagraphs(sectionNumber, paragraphs) {
  const stack = [];
  let lastLevelOne = null;
  return paragraphs.map((text, index) => {
    const marker = markerOf(text);
    const level = marker ? levelOf(marker, markerOf(paragraphs[index + 1] ?? ''), lastLevelOne) : null;
    if (level !== null) {
      stack.length = level - 1;
      stack[level - 1] = marker;
      if (level === 1) lastLevelOne = marker;
    }
    return { text, startsGroup: level === 1, anchor: `${sectionNumber}${stack.map((m) => `(${m})`).join('')}` };
  });
}

/** Group paragraphs into chunks: one per (a)-level group, split at paragraph boundaries when large. */
function chunkParagraphs(annotated) {
  const chunks = [];
  let current = null;
  const flush = () => {
    if (current) chunks.push(current);
    current = null;
  };
  for (const paragraph of annotated) {
    if (paragraph.startsGroup) flush();
    for (const piece of splitLongText(paragraph.text, MAX_CHUNK_CHARS)) {
      if (current && current.size + piece.length + 1 > MAX_CHUNK_CHARS) flush();
      if (!current) current = { anchor: paragraph.anchor, parts: [], size: 0 };
      current.parts.push(piece);
      current.size += piece.length + 1;
    }
  }
  flush();
  return chunks;
}

const LABEL_CHARS = 40;

/**
 * Citation text for a chunk. The first chunk at an anchor is just the anchor; a later chunk at the
 * same anchor (typically a run of unnumbered paragraphs, like the definitions in 205.2) is told
 * apart by its opening words, and only as a last resort by a counter.
 */
function uniqueCitation(base, chunk, seen) {
  const opening = chunk.parts[0].slice(0, LABEL_CHARS + 1);
  const label = (opening.length > LABEL_CHARS ? opening.slice(0, opening.lastIndexOf(' ')) : opening).replace(/[\s.,;:—-]+$/, '');
  const candidates = [base, `${base} “${label}”`];
  let citation = candidates.find((c) => !seen.has(c));
  for (let n = 2; citation === undefined; n += 1) {
    const counted = `${base} “${label}” (cont. ${n})`;
    if (!seen.has(counted)) citation = counted;
  }
  seen.add(citation);
  return citation;
}

/**
 * @param {string} xml eCFR XML for one part (as served by the eCFR versioner API)
 * @param {{ versionDate: string, part?: string }} options versionDate is the eCFR "as of" date
 * @returns {Array<{ title_number: number, part: string, section: string, anchor: string, citation: string,
 *   heading: string, body: string, ord: number, source_url: string, version_date: string }>}
 */
export function parseEcfrPart(xml, { versionDate, part = '205' }) {
  if (!ISO_DATE.test(versionDate ?? '')) throw new Error('A version date (YYYY-MM-DD) is required.');

  const rows = [];
  let sectionCount = 0;
  for (const match of xml.matchAll(/<DIV8 N="([^"]+)" TYPE="SECTION"[^>]*>([\s\S]*?)<\/DIV8>/g)) {
    sectionCount += 1;
    const [, sectionNumber, inner] = match;
    const headRaw = /<HEAD>([\s\S]*?)<\/HEAD>/.exec(inner)?.[1] ?? '';
    const heading = plainText(headRaw).replace(/^§\s*[\d.]+\s*/, '');
    const withoutNotes = inner.replace(/<CITA>[\s\S]*?<\/CITA>/g, '').replace(/<EDNOTE>[\s\S]*?<\/EDNOTE>/g, '');
    const paragraphs = [...withoutNotes.matchAll(/<P>([\s\S]*?)<\/P>/g)].map((p) => plainText(p[1])).filter(Boolean);

    const seen = new Set();
    chunkParagraphs(annotateParagraphs(sectionNumber, paragraphs)).forEach((chunk, index) => {
      const citation = uniqueCitation(`${TITLE_NUMBER} CFR ${chunk.anchor}`, chunk, seen);
      rows.push({
        title_number: TITLE_NUMBER,
        part,
        section: sectionNumber,
        anchor: chunk.anchor,
        citation,
        heading,
        body: chunk.parts.join('\n'),
        ord: index + 1,
        source_url: `https://www.ecfr.gov/current/title-${TITLE_NUMBER}/section-${sectionNumber}`,
        version_date: versionDate,
      });
    });
  }
  if (sectionCount === 0) throw new Error('No sections found: is this the eCFR XML for a CFR part?');
  return rows;
}
