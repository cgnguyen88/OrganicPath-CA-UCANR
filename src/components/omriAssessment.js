/**
 * The OMRI assistant's answer: a one-line verdict (shown as a badge) followed by the written
 * assessment (shown as a formatted document). The prompt asks for plain words, and this also reads
 * the older emoji style so a cached or off-format answer still gets its badge.
 */

const STATUS_LABELS = {
  allowed: 'Likely Allowed',
  restricted: 'Allowed with Restrictions',
  prohibited: 'Likely Prohibited',
  unknown: 'Cannot Determine — verify at omri.org',
};

const LOOK_AT_FIRST_LINES = 6;
const STATUS_LINE = /^[\s*_#>-]*(?:likely\s+)?status[\s*_]*:[\s*_]*(.+?)[\s*_]*$/i;
const EMOJI_STATUS = { '✅': 'allowed', '⚠': 'restricted', '❌': 'prohibited', '❓': 'unknown' };

export const OMRI_PROMPT_LAYOUT = `Provide the assessment in exactly this layout:

STATUS: <one of exactly: Likely Allowed, Allowed with Restrictions, Likely Prohibited, Cannot Determine>

## Reasoning
2-4 sentences explaining your assessment, citing specific NOP sections (§205.601-606, §205.204, §205.203, etc.) as applicable.

## Key Concerns
A bulleted list of 2-4 specific things the grower should check, such as prohibited additives, application restrictions, formulation variants or documentation needed.

## Verification Step
One specific instruction for how to confirm the status at omri.org or with their certifier.

Do not use emoji.`;

/** How each verdict starts, tried in order: the model is told to begin with one of these four. */
const VERDICT_OPENINGS = [
  ['restricted', /^(?:likely\s+)?allowed\s+(?:with|only|subject|if|when|under)\b/],
  ['unknown', /^cannot\s+determine\b/],
  ['allowed', /^(?:likely\s+)?allowed\b/],
];
/** "not allowed", "disallowed", "non-allowed", "not likely to be permitted", "never allowed" ... */
const NEGATED_ALLOWANCE = /\b(?:not|non|no|never|isn't|aren't|can't|cannot|dis|un)[-\s]*(?:\w+\s+){0,3}(?:allow|permit)/;

/** What a line of words says when it does not begin with one of the four verdicts. */
function statusFromOtherWords(text) {
  if (/prohibit/.test(text) || NEGATED_ALLOWANCE.test(text)) return 'prohibited';
  if (/cannot determine|can't determine|unable to determine|unknown|unclear/.test(text)) return 'unknown';
  if (/restrict|conditions?\b|verify/.test(text)) return 'restricted';
  if (/allow/.test(text)) return 'allowed';
  return null;
}

function statusFromWords(words) {
  const text = words.toLowerCase().trim();
  const opening = VERDICT_OPENINGS.find(([, pattern]) => pattern.test(text));
  return opening ? opening[0] : statusFromOtherWords(text);
}

/** The verdict a line states: "STATUS: …" with words or an emoji, or an older line that starts with an emoji. */
function readStatus(line) {
  const labelled = STATUS_LINE.exec(line);
  const claimed = labelled ? labelled[1] : line.trim().replace(/^[*_#>\s-]+/, '');
  const fromEmoji = EMOJI_STATUS[[...claimed][0]];
  return fromEmoji ?? (labelled ? statusFromWords(claimed) : null);
}

function findStatusLine(lines) {
  for (let index = 0; index < Math.min(lines.length, LOOK_AT_FIRST_LINES); index += 1) {
    const status = readStatus(lines[index]);
    if (status) return { index, status };
  }
  return null;
}

/**
 * @param {unknown} text the model's answer
 * @returns {{ status: 'allowed' | 'restricted' | 'prohibited' | 'unknown' | null, label: string, body: string }}
 */
export function parseOmriAssessment(text) {
  if (typeof text !== 'string' || !text.trim()) return { status: null, label: '', body: '' };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const found = findStatusLine(lines);
  if (!found) return { status: null, label: '', body: text.trim() };
  const body = [...lines.slice(0, found.index), ...lines.slice(found.index + 1)].join('\n').trim();
  return { status: found.status, label: STATUS_LABELS[found.status], body };
}
