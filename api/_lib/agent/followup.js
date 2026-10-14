import { KIND_FIELDS } from '../../../src/domain/records/kinds.js';
import { evaluateRecord } from '../../../src/domain/records/schemas.js';
import { buildReplySystem } from './prompts.js';
import { buildRecordTools, toolNameForKind } from './tools.js';
import { isObject, withoutBlank } from './sanitize.js';
import { fieldListLine } from './fieldNames.js';

/** Ask for at most this many details per message; the rest follow in the next round. */
export const MAX_QUESTIONS = 3;

const QUESTIONS = {
  en: {
    record_date: 'What date was this?',
    activity_type: 'What kind of activity was it (spray, irrigation, …)?',
    field: 'Which field or block?',
    product: 'Which product did you use?',
    rate: 'At what mix rate?',
    target: 'Which pest or disease was it for?',
    crop: 'Which crop?',
    variety: 'Which variety?',
    quantity: 'How much?',
    unit: 'In what unit?',
    supplier: 'Which supplier?',
    material: 'Which material?',
    item: 'Which item?',
    text: 'What should the note say?',
  },
  es: {
    record_date: '¿De qué fecha es?',
    activity_type: '¿Qué tipo de actividad fue (aplicación, riego, …)?',
    field: '¿Qué campo o bloque?',
    product: '¿Qué producto usaste?',
    rate: '¿Con qué dosis de mezcla?',
    target: '¿Para qué plaga o enfermedad fue?',
    crop: '¿Qué cultivo?',
    variety: '¿Qué variedad?',
    quantity: '¿Cuánto?',
    unit: '¿En qué unidad?',
    supplier: '¿Qué proveedor?',
    material: '¿Qué material?',
    item: '¿Qué artículo?',
    text: '¿Qué debe decir la nota?',
  },
};

const labelOf = (kind, key, lang) => KIND_FIELDS[kind]?.find((f) => f.key === key)?.label[lang] ?? key;

/**
 * The follow-up question(s) for what a record is still missing, in the worker's language. These
 * are templates, so asking costs nothing and cannot be steered by anything in the input.
 *
 * @param {string} kind
 * @param {string[]} missing keys from the record's evaluation
 * @param {string} lang 'en' | 'es'
 * @returns {{ text: string, asked: string[] }}
 */
export function questionsFor(kind, missing, lang) {
  const L = lang === 'es' ? 'es' : 'en';
  const asked = missing.slice(0, MAX_QUESTIONS);
  if (asked.length === 0) return { text: '', asked: [] };

  const lines = asked.map((key) => QUESTIONS[L][key] ?? (L === 'es' ? `¿Cuál es ${labelOf(kind, key, L)}?` : `What is the ${labelOf(kind, key, L)}?`));
  const intro = asked.length === 1
    ? (L === 'es' ? 'Un dato más:' : 'One more detail:')
    : (L === 'es' ? 'Necesito estos datos para completar el registro:' : 'I need a few details to finish this record:');
  return { text: [intro, ...lines.map((line) => `• ${line}`)].join('\n'), asked };
}

/**
 * Merge a worker's reply into a draft record. The model fills only the fields the reply states;
 * everything it returns is re-validated, and a value that does not validate is ignored (and
 * reported) rather than stored.
 *
 * @param {{
 *   anthropic: { messages: { create: Function } },
 *   config: { agent: { model: string, maxTokens: number, effort: string, strictTools: boolean, requestTimeoutMs: number } },
 *   draft: { kind: string, record_date?: string | null, payload?: Record<string, unknown> },
 *   replyText: string,
 *   today: string,
 *   signal?: AbortSignal,
 *   allowedKeys?: string[],
 *   fieldNames?: string[],
 * }} args
 *   `allowedKeys` (payload keys, and/or 'record_date') limits what a reply may change; anything
 *   else the model returns is ignored and reported in `rejected`. Omit it to allow every field.
 */
export async function applyReply({ anthropic, config, draft, replyText, today, signal, allowedKeys, fieldNames }) {
  const reply = typeof replyText === 'string' ? replyText.trim() : '';
  if (reply === '') throw new Error('A reply is required.');

  const { kind } = draft;
  const tool = buildRecordTools({ strict: config.agent.strictTools }).find((t) => t.name === toolNameForKind(kind));
  const current = JSON.stringify({ kind, record_date: draft.record_date ?? null, payload: draft.payload ?? {} });
  const fieldLine = fieldListLine(fieldNames);

  const response = await anthropic.messages.create(
    {
      model: config.agent.model,
      max_tokens: config.agent.maxTokens,
      system: buildReplySystem({ today, kind }),
      tools: [tool],
      tool_choice: { type: 'auto' },
      output_config: { effort: config.agent.effort },
      messages: [{ role: 'user', content: `Current record (JSON):\n${current}\n\n${fieldLine ? `${fieldLine}\n\n` : ''}Worker's reply:\n${reply}` }],
    },
    { timeout: config.agent.requestTimeoutMs, ...(signal ? { signal } : {}) },
  );

  const blocks = response.content ?? [];
  const call = blocks.find((b) => b.type === 'tool_use' && b.name === tool.name);
  const message = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n').trim();

  const baseDate = draft.record_date ?? undefined;
  const basePayload = draft.payload ?? {};
  const patch = isObject(call?.input) ? call.input : {};
  const proposedPayload = isObject(patch.payload) ? withoutBlank(patch.payload) : {};
  const proposedDate = typeof patch.record_date === 'string' && patch.record_date.trim() ? patch.record_date.trim() : undefined;

  // A reply fills in what was asked; it must not be able to quietly rewrite other fields (the
  // record's own text, which came from a photo, is untrusted input to this very model call).
  const allowed = allowedKeys ? new Set(allowedKeys) : null;
  const outOfScope = [];
  const inScope = (key, proposed, current) => {
    if (!allowed || allowed.has(key)) return true;
    if (proposed !== current) outOfScope.push(key);
    return false;
  };
  const patchPayload = Object.fromEntries(Object.entries(proposedPayload).filter(([key, value]) => inScope(key, value, basePayload[key])));
  const patchDate = proposedDate !== undefined && inScope('record_date', proposedDate, baseDate) ? proposedDate : undefined;

  let date = patchDate ?? baseDate;
  let payload = { ...basePayload, ...patchPayload };
  let evaluation = evaluateRecord(kind, { record_date: date, payload });
  const rejected = [...outOfScope];

  if (!evaluation.ok) {
    for (const key of Object.keys(evaluation.errors)) {
      rejected.push(key);
      if (key === 'record_date') date = baseDate;
      else if (key in basePayload) payload[key] = basePayload[key];
      else delete payload[key];
    }
    evaluation = evaluateRecord(kind, { record_date: date, payload });
  }

  const finalPayload = evaluation.value?.payload ?? basePayload;
  const finalDate = evaluation.value?.record_date ?? null;
  const applied = [
    ...(finalDate !== (draft.record_date ?? null) ? ['record_date'] : []),
    ...Object.keys(patchPayload).filter((key) => !rejected.includes(key) && finalPayload[key] !== basePayload[key]),
  ];

  return {
    record: { kind, record_date: finalDate, payload: finalPayload },
    evaluation,
    applied,
    rejected,
    message,
    usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
  };
}
