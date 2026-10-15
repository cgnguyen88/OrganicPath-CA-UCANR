/**
 * Inline markdown → a small tree of plain objects. Nothing here produces HTML:
 * the screen turns the tree into React elements, so model output can never
 * inject markup. Emphasis follows the CommonMark flanking rules, so arithmetic
 * (`5 * 3`), snake_case and half-written (still streaming) text stay literal.
 *
 * Nodes: text, strong, em, code, link, marker, break.
 * A link only ever goes to http, https or mailto, and shows where it really goes.
 */

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const WHITESPACE = /\s/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const MARKER = /^\[NEEDS OPERATOR INPUT:\s*([^\]]*)\]/;
const SAFE_HREF = /^(?:https?:\/\/[^\s<>\p{Cc}]+|mailto:[^\s<>\p{Cc}]+)$/iu;
const LINK_TARGET = /^(\S+)(?:\s+(?:"[^"]*"|'[^']*'))?$/;
const BARE_ADDRESS = /(?:https?:\/\/|www\.)[^\s<>\p{Cc}]{1,2000}/iuy;
const ANGLE_ADDRESS = /<(https?:\/\/[^\s<>\p{Cc}]{1,2000})>/iuy;
const BREAK_TAG = /<br\s*\/?>/iy;
const LOOKS_LIKE_ADDRESS = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;
const TRAILING_PUNCTUATION = /[?!.,:;*_~'"]+$/;
const MAX_LABEL_LENGTH = 1000;
const MAX_TARGET_LENGTH = 2000;
const MAX_DELIMITERS = 2000;
const MAX_EMPHASIS_DEPTH = 8;

const isSpace = (ch) => ch === undefined || WHITESPACE.test(ch);
const isPunct = (ch) => ch !== undefined && PUNCTUATION.test(ch);
const isWordChar = (ch) => ch !== undefined && !isSpace(ch) && !isPunct(ch);
const textNode = (text) => ({ type: 'text', text });

/** Can a `*` or `_` run between `before` and `after` open and/or close emphasis? */
function flanking(ch, before, after) {
  const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
  const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
  if (ch === '*') return { canOpen: left, canClose: right };
  return {
    canOpen: left && (!right || isPunct(before)),
    canClose: right && (!left || isPunct(after)),
  };
}

function delimiterToText(node) {
  return node.type === 'delim' ? textNode(node.ch.repeat(node.count)) : node;
}

/** Turn leftover delimiters into text and merge neighbouring text nodes. */
function finish(nodes) {
  const merged = [];
  for (const node of nodes.map(delimiterToText)) {
    const last = merged[merged.length - 1];
    if (node.type === 'text' && last?.type === 'text') merged[merged.length - 1] = textNode(last.text + node.text);
    else merged.push(node);
  }
  return merged;
}

function findOpener(nodes, closerIndex) {
  const closer = nodes[closerIndex];
  for (let i = closerIndex - 1; i >= 0; i -= 1) {
    const opener = nodes[i];
    if (opener.type !== 'delim' || !opener.canOpen || opener.ch !== closer.ch) continue;
    const oddMatch = (opener.canClose || closer.canOpen)
      && (opener.count + closer.count) % 3 === 0
      && !(opener.count % 3 === 0 && closer.count % 3 === 0);
    if (!oddMatch) return i;
  }
  return -1;
}

/** How many emphasis marks are nested inside each wrapper, so absurdly deep nesting is refused. */
const EMPHASIS_DEPTH = new WeakMap();
const depthOf = (children) => 1 + children.reduce((deepest, child) => Math.max(deepest, EMPHASIS_DEPTH.get(child) ?? 0), 0);

function resolveEmphasis(nodes) {
  if (nodes.filter((node) => node.type === 'delim').length > MAX_DELIMITERS) return nodes;
  let c = 0;
  while (c < nodes.length) {
    const closer = nodes[c];
    const o = closer.type === 'delim' && closer.canClose ? findOpener(nodes, c) : -1;
    const children = o < 0 ? null : finish(nodes.slice(o + 1, c));
    if (!children || depthOf(children) > MAX_EMPHASIS_DEPTH) {
      c += 1;
      continue;
    }
    const opener = nodes[o];
    const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const wrapper = { type: used === 2 ? 'strong' : 'em', children };
    EMPHASIS_DEPTH.set(wrapper, depthOf(children));
    nodes.splice(o + 1, c - o - 1, wrapper);
    const remainingOpener = { ...opener, count: opener.count - used };
    const remainingCloser = { ...closer, count: closer.count - used };
    nodes.splice(o, 3, ...[
      ...(remainingOpener.count > 0 ? [remainingOpener] : []),
      wrapper,
      ...(remainingCloser.count > 0 ? [remainingCloser] : []),
    ]);
    c = o + (remainingOpener.count > 0 ? 2 : 1);
  }
  return nodes;
}

/** Index of the backtick run that closes a code span opened by `length` backticks. */
function findCodeEnd(text, from, length) {
  let j = from;
  while (j < text.length) {
    if (text[j] !== '`') {
      j += 1;
      continue;
    }
    let run = 0;
    while (text[j + run] === '`') run += 1;
    if (run === length) return j;
    j += run;
  }
  return -1;
}

/** Index of the bracket that closes the one opened just before `from`. */
function findClosing(text, from, open, close, limit) {
  let depth = 1;
  const end = Math.min(text.length, from + limit);
  for (let j = from; j < end; j += 1) {
    if (text[j] === '\\') j += 1;
    else if (text[j] === open) depth += 1;
    else if (text[j] === close && (depth -= 1) === 0) return j;
  }
  return -1;
}

const countOf = (text, ch) => text.split(ch).length - 1;

function hostOf(address) {
  try {
    return new URL(/^[a-z]+:/i.test(address) ? address : `https://${address}`).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** The words of a link. Empty words, or words that look like another website, are replaced by the real address. */
function linkWords(children, href) {
  if (children.length === 0) return [textNode(href)];
  const words = children.length === 1 && children[0].type === 'text' ? children[0].text.trim() : '';
  const claimsOtherSite = LOOKS_LIKE_ADDRESS.test(words) && hostOf(words) !== hostOf(href);
  return claimsOtherSite ? [textNode(href)] : children;
}

/** Nodes for `[label](target)`; only http, https and mailto become links. */
function linkNodes(label, target, parse) {
  const children = parse(label, { inLink: true });
  const match = LINK_TARGET.exec(target.trim());
  const written = match ? match[1] : '';
  const href = /^www\./i.test(written) ? `https://${written}` : written;
  if (!SAFE_HREF.test(href)) return children;
  const destination = /^mailto:/i.test(href) ? href.split('?')[0] : href;
  return [{ type: 'link', href: destination, children: linkWords(children, destination) }];
}

/** A scanner's state while it reads one piece of text. */
function newScan(source, options) {
  return { source, options, nodes: [], buffer: '', unmatchedCodeRuns: new Set() };
}

function flush(scan) {
  if (scan.buffer) scan.nodes.push(textNode(scan.buffer));
  scan.buffer = '';
}

function emit(scan, ...nodes) {
  flush(scan);
  scan.nodes.push(...nodes);
}

function readEscape(scan, i) {
  const next = scan.source[i + 1];
  const escapes = next !== undefined && ESCAPABLE.includes(next);
  scan.buffer += escapes ? next : scan.source[i];
  return i + (escapes ? 2 : 1);
}

function readCodeSpan(scan, i) {
  const { source } = scan;
  let length = 1;
  while (source[i + length] === '`') length += 1;
  const end = scan.unmatchedCodeRuns.has(length) ? -1 : findCodeEnd(source, i + length, length);
  if (end < 0) {
    scan.unmatchedCodeRuns.add(length);
    scan.buffer += '`'.repeat(length);
    return i + length;
  }
  let content = source.slice(i + length, end).replace(/\n/g, ' ');
  if (content.length > 1 && content.startsWith(' ') && content.endsWith(' ') && content.trim()) content = content.slice(1, -1);
  emit(scan, { type: 'code', text: content });
  return end + length;
}

function readDelimiterRun(scan, i) {
  const { source } = scan;
  const ch = source[i];
  let count = 1;
  while (source[i + count] === ch) count += 1;
  emit(scan, { type: 'delim', ch, count, ...flanking(ch, source[i - 1], source[i + count]) });
  return i + count;
}

function readBracket(scan, i) {
  const { source, options } = scan;
  const marker = MARKER.exec(source.slice(i, i + 400));
  if (marker) {
    emit(scan, { type: 'marker', text: marker[1].trim() });
    return i + marker[0].length;
  }
  const labelEnd = options.inLink ? -1 : findClosing(source, i + 1, '[', ']', MAX_LABEL_LENGTH);
  const targetEnd = labelEnd >= 0 && source[labelEnd + 1] === '(' ? findClosing(source, labelEnd + 2, '(', ')', MAX_TARGET_LENGTH) : -1;
  const target = targetEnd >= 0 ? source.slice(labelEnd + 2, targetEnd) : '';
  if (!target.trim()) {
    scan.buffer += '[';
    return i + 1;
  }
  emit(scan, ...linkNodes(source.slice(i + 1, labelEnd), target, parseInline));
  return targetEnd + 1;
}

/** `<br>` is a line break and `<https://…>` is a link; any other `<` is just text. */
function readAngle(scan, i) {
  BREAK_TAG.lastIndex = i;
  const lineBreak = BREAK_TAG.exec(scan.source);
  if (lineBreak) {
    emit(scan, { type: 'break' });
    return i + lineBreak[0].length;
  }
  ANGLE_ADDRESS.lastIndex = i;
  const angle = scan.options.inLink ? null : ANGLE_ADDRESS.exec(scan.source);
  if (angle) {
    emit(scan, { type: 'link', href: angle[1], children: [textNode(angle[1])] });
    return i + angle[0].length;
  }
  scan.buffer += '<';
  return i + 1;
}

/** The address a bare `https://…` or `www.…` stands for, without the punctuation that ends a sentence. */
function trimAddress(raw) {
  let address = raw.replace(TRAILING_PUNCTUATION, '');
  while (address.endsWith(')') && countOf(address, ')') > countOf(address, '(')) address = address.slice(0, -1).replace(TRAILING_PUNCTUATION, '');
  return address;
}

function readBareAddress(scan, i) {
  const { source } = scan;
  BARE_ADDRESS.lastIndex = i;
  const found = scan.options.inLink || isWordChar(source[i - 1]) ? null : BARE_ADDRESS.exec(source);
  const address = found ? trimAddress(found[0]) : '';
  const href = /^www\./i.test(address) ? `https://${address}` : address;
  if (!address || hostOf(href) === '') {
    scan.buffer += source[i];
    return i + 1;
  }
  emit(scan, { type: 'link', href, children: [textNode(address)] });
  return i + address.length;
}

/**
 * @param {string} text
 * @param {{ inLink?: boolean }} [options]
 * @returns {object[]}
 */
export function parseInline(text, options = {}) {
  const scan = newScan(typeof text === 'string' ? text : '', options);
  const { source } = scan;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') i = readEscape(scan, i);
    else if (ch === '\n') {
      emit(scan, { type: 'break' });
      i += 1;
    } else if (ch === '`') i = readCodeSpan(scan, i);
    else if (ch === '*' || ch === '_') i = readDelimiterRun(scan, i);
    else if (ch === '[') i = readBracket(scan, i);
    else if (ch === '<') i = readAngle(scan, i);
    else if (ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') i = readBareAddress(scan, i);
    else {
      scan.buffer += ch;
      i += 1;
    }
  }
  flush(scan);
  return finish(resolveEmphasis(scan.nodes));
}
