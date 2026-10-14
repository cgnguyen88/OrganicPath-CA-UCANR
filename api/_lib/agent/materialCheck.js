import { buildMaterialSystem } from './materialPrompt.js';

/** Search/answer rounds before giving up. Each round is one model call. */
export const MAX_ROUNDS = 5;
export const MAX_SEARCHES_PER_ROUND = 3;
const MAX_QUERY_CHARS = 200;
const MAX_SUMMARY_CHARS = 1200;
const MAX_CAVEATS = 5;
const MAX_CAVEAT_CHARS = 300;
const EXCERPT_CHARS = 400;
const PASSAGE_CHARS_FOR_MODEL = 1500;

export const VERDICTS = Object.freeze(['listed_allowed', 'prohibited', 'not_named', 'needs_review']);
/** Verdicts that assert something about the law, so they need a retrieved citation behind them. */
const ASSERTIVE = ['listed_allowed', 'prohibited'];

const TOOLS = [
  {
    name: 'search_regulations',
    description: 'Search the text of 7 CFR Part 205 (U.S. organic regulations). Returns matching passages with their citations. Use short English keywords.',
    input_schema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', description: 'Short English keywords, 1 to 6 words.' } }, required: ['query'] },
  },
  {
    name: 'report_material_check',
    description: 'Report your finding. Call exactly once, after searching.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: VERDICTS },
        summary: { type: 'string', description: 'A few plain sentences for the farm worker.' },
        cited: { type: 'array', items: { type: 'string' }, description: 'Citations exactly as returned by search_regulations, e.g. "7 CFR 205.601(i)".' },
        caveats: { type: 'array', items: { type: 'string' }, description: 'Restrictions, annotations, or things to confirm.' },
      },
      required: ['verdict', 'summary', 'cited', 'caveats'],
    },
  },
];

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const formatPassages = (passages) =>
  passages.length === 0
    ? 'No passages matched.'
    : passages.map((p) => `Citation: ${p.citation}\nHeading: ${p.heading}\nText: ${p.body.slice(0, PASSAGE_CHARS_FOR_MODEL)}`).join('\n---\n');

const excerptOf = (body) => (body.length > EXCERPT_CHARS ? `${body.slice(0, EXCERPT_CHARS)}…` : body);

/**
 * Check a material against 7 CFR 205 with a bounded search-then-answer loop.
 *
 * The model proposes a verdict; this function decides what may be said. Citations must be ones
 * the searches actually returned (the excerpt shown comes from the database, never the model),
 * and a verdict that asserts "allowed" or "prohibited" is downgraded to needs_review when no
 * retrieved citation backs it. Absence from the lists is "not_named", never "prohibited".
 *
 * @param {{
 *   anthropic: { messages: { create: Function } },
 *   config: { agent: { model: string, maxTokens: number, effort: string, strictTools: boolean, requestTimeoutMs: number } },
 *   search: (query: string) => Promise<Array<{ citation: string, heading: string, body: string, source_url: string, version_date: string }>>,
 *   input: { material: string, use?: string },
 *   today: string, lang: 'en' | 'es', signal?: AbortSignal,
 * }} args
 */
export async function checkMaterial({ anthropic, config, search, input, today, lang, signal }) {
  const system = buildMaterialSystem({ today, lang });
  const tools = TOOLS.map((tool) => (config.agent.strictTools ? { ...tool, strict: true } : tool));
  const messages = [{ role: 'user', content: `Material: ${input.material}\nIntended use: ${input.use?.trim() || '(not stated)'}` }];

  const retrieved = new Map(); // citation -> passage
  const usage = { input_tokens: 0, output_tokens: 0 };
  let searches = 0;

  const finish = (verdict, parts = {}) => ({
    verdict, downgraded: false, refused: false, incomplete: false, summary: '', caveats: [], sources: [], searches, usage, ...parts,
  });

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await anthropic.messages.create(
      {
        model: config.agent.model,
        max_tokens: config.agent.maxTokens,
        system,
        tools,
        tool_choice: { type: 'auto' },
        output_config: { effort: config.agent.effort },
        messages,
      },
      { timeout: config.agent.requestTimeoutMs, ...(signal ? { signal } : {}) },
    );
    usage.input_tokens += response.usage?.input_tokens ?? 0;
    usage.output_tokens += response.usage?.output_tokens ?? 0;

    if (response.stop_reason === 'refusal') return finish('needs_review', { refused: true });

    const blocks = response.content ?? [];
    const toolCalls = blocks.filter((b) => b.type === 'tool_use');
    const reportCall = toolCalls.find((b) => b.name === 'report_material_check');
    if (reportCall) return interpret(reportCall.input, retrieved, finish);

    if (toolCalls.length === 0) {
      const words = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return finish('needs_review', { summary: clip(words, MAX_SUMMARY_CHARS) });
    }

    // Answer EVERY tool call (the API requires it), running only a few searches.
    const results = [];
    let ranThisRound = 0;
    for (const call of toolCalls) {
      const query = call.input?.query;
      if (call.name !== 'search_regulations' || typeof query !== 'string' || query.trim() === '') {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Invalid or unknown tool call.' });
      } else if (ranThisRound >= MAX_SEARCHES_PER_ROUND) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Too many searches at once. Use fewer, broader queries.' });
      } else {
        ranThisRound += 1;
        searches += 1;
        try {
          const passages = await search(query.trim().slice(0, MAX_QUERY_CHARS));
          for (const passage of passages) if (!retrieved.has(passage.citation)) retrieved.set(passage.citation, passage);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: formatPassages(passages) });
        } catch {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'Search is unavailable right now.' });
        }
      }
    }
    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: results });
  }

  return finish('needs_review', { incomplete: true });
}

/** Turn the model's report into what we are willing to say. */
function interpret(input, retrieved, finish) {
  const report = input && typeof input === 'object' ? input : {};
  const claimed = VERDICTS.includes(report.verdict) ? report.verdict : 'needs_review';

  const cited = [...new Set((Array.isArray(report.cited) ? report.cited : []).filter((c) => typeof c === 'string').map((c) => c.trim()))];
  const sources = cited
    .filter((citation) => retrieved.has(citation))
    .map((citation) => {
      const p = retrieved.get(citation);
      return { citation, heading: p.heading, excerpt: excerptOf(p.body), source_url: p.source_url, version_date: p.version_date };
    });

  const unsupported = retrieved.size === 0 || (ASSERTIVE.includes(claimed) && sources.length === 0);
  if (unsupported || report.verdict !== claimed) {
    // We cannot stand behind it: say "needs review" and drop the model's prose, which may argue
    // for the verdict we just refused to give.
    return finish('needs_review', { downgraded: report.verdict !== 'needs_review', sources });
  }

  const caveats = (Array.isArray(report.caveats) ? report.caveats : []).map((c) => clip(c, MAX_CAVEAT_CHARS)).filter(Boolean).slice(0, MAX_CAVEATS);
  return finish(claimed, { summary: clip(report.summary, MAX_SUMMARY_CHARS), caveats, sources });
}
