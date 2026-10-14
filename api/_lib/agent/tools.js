import { RECORD_KINDS, KIND_FIELDS } from '../../../src/domain/records/kinds.js';

/**
 * Tool definitions for the extraction agent, generated from the domain's field definitions so
 * the form, the database and the agent describe a record identically. There is one tool per
 * record kind and no other tool: the agent can only PROPOSE records, never approve, edit or
 * delete anything. Its output is re-validated server-side regardless of what the model returns.
 */

const TOOL_PREFIX = 'record_';

/** @param {string} kind */
export const toolNameForKind = (kind) => `${TOOL_PREFIX}${kind}`;

/**
 * @param {unknown} name
 * @returns {string | null} the record kind, or null for any name that is not one of our tools
 */
export function kindForToolName(name) {
  if (typeof name !== 'string' || !name.startsWith(TOOL_PREFIX)) return null;
  const kind = name.slice(TOOL_PREFIX.length);
  return RECORD_KINDS.includes(kind) ? kind : null;
}

/** When to use each tool; also shown to the model in the system prompt. */
export const KIND_GUIDANCE = Object.freeze({
  activity: 'A field activity. Any spray application (pest, disease or foliar spray: product, mix rate, target pest) is an activity with activity_type "spray". Also irrigation, cultivation, scouting, pruning, mowing.',
  purchase: 'Something bought: one invoice or receipt line (supplier, product, quantity, cost). One call per product line.',
  note: 'A free-text observation, reminder or inspection note that fits no other kind.',
  seed: 'Seed or transplants received or on hand: crop, variety, supplier, lot number, and whether it is organic, untreated or treated.',
  planting: 'Seed or transplants put in the ground: crop, variety, field or block.',
  amendment: 'Fertilizer, compost, soil amendment or similar material APPLIED to a field: material, field, rate, method.',
  harvest: 'A crop harvested: crop, field, quantity and unit, lot number, destination.',
  input: 'A product kept on hand as an input (fertilizer, pest control, seed treatment, cleaner), described by its label: manufacturer, active ingredients, OMRI listing.',
  inventory: 'A count of something currently in stock: item, quantity, unit, location. Add a reorder level only if it is stated, and an OMRI status only if an OMRI seal or listing is visible.',
});

function fieldSchema(field) {
  const description = `${field.label.en} / ${field.label.es}`;
  if (field.type === 'number') return { type: ['number', 'null'], description };
  if (field.type === 'select') {
    const values = field.options.map((o) => o.value);
    return { anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }], description: `${description}. One of: ${values.join(', ')}.` };
  }
  return { type: ['string', 'null'], description };
}

function toolFor(kind, strict) {
  const fields = KIND_FIELDS[kind];
  const tool = {
    name: toolNameForKind(kind),
    description: `Record one ${kind} record. ${KIND_GUIDANCE[kind]} Use null for any field that is not stated or visible; never guess.`,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        record_date: { type: ['string', 'null'], description: 'The date the event happened, as YYYY-MM-DD, or null if it is not stated or visible. Do not guess.' },
        confidence: { type: 'number', description: 'Your certainty, from 0 to 1, that the key fields were read correctly. Use below 0.6 for blurry or ambiguous input.' },
        payload: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f)])),
          required: fields.map((f) => f.key),
        },
      },
      required: ['record_date', 'confidence', 'payload'],
    },
  };
  return strict ? { ...tool, strict: true } : tool;
}

/**
 * @param {{ strict?: boolean }} [options] `strict` (default true) asks the API to guarantee the
 *   arguments match the schema; the server validates them again either way.
 */
export function buildRecordTools({ strict = true } = {}) {
  return RECORD_KINDS.map((kind) => toolFor(kind, strict));
}
