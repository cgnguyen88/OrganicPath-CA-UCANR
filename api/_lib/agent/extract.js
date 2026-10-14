import { buildExtractionSystem } from './prompts.js';
import { buildRecordTools, kindForToolName } from './tools.js';
import { clampConfidence, sanitizeProposal } from './sanitize.js';
import { fieldListLine } from './fieldNames.js';

/** Never create more than this many records from a single message or photo. */
export const MAX_PROPOSALS = 10;
const FILE_ONLY_INSTRUCTION = 'Extract the farm records from the attached file.';

function buildContent({ text, attachments }, fieldNames) {
  const files = attachments ?? [];
  const words = typeof text === 'string' ? text.trim() : '';
  if (files.length === 0 && words === '') throw new Error('There is nothing to extract: send text or a file.');
  const fieldLine = fieldListLine(fieldNames);
  return [...(fieldLine ? [{ type: 'text', text: fieldLine }] : []), ...files, { type: 'text', text: words === '' ? FILE_ONLY_INSTRUCTION : words }];
}

const pickUsage = (usage) => ({ input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0 });

/**
 * Read one message and/or photo/document and PROPOSE farm records from it. The model only ever
 * proposes: every proposal is re-validated and normalized here, and nothing is saved by this
 * function. Throws on API errors (the caller maps them to a safe response).
 *
 * @param {{
 *   anthropic: { messages: { create: Function } },
 *   config: { agent: { model: string, maxTokens: number, effort: string, strictTools: boolean, requestTimeoutMs: number } },
 *   input: { text?: string, attachments?: Array<object> },
 *   today: string,
 *   signal?: AbortSignal,
 *   fieldNames?: string[],
 * }} args
 *   `fieldNames` are the farm's field names; the model is told them (as data) so it spells a field the way the farm does.
 */
export async function extractRecords({ anthropic, config, input, today, signal, fieldNames }) {
  const content = buildContent(input, fieldNames);

  // tool_choice is "auto": forced tool use is rejected by this model family, and a photo with no
  // farm record in it should be answered in words, not forced into a record.
  const response = await anthropic.messages.create(
    {
      model: config.agent.model,
      max_tokens: config.agent.maxTokens,
      system: buildExtractionSystem({ today }),
      tools: buildRecordTools({ strict: config.agent.strictTools }),
      tool_choice: { type: 'auto' },
      output_config: { effort: config.agent.effort },
      messages: [{ role: 'user', content }],
    },
    { timeout: config.agent.requestTimeoutMs, ...(signal ? { signal } : {}) },
  );

  const proposals = [];
  const messages = [];
  let ignoredToolCalls = 0;
  let skippedProposals = 0;
  let tooMany = false;

  for (const block of response.content ?? []) {
    if (block.type === 'text' && block.text) {
      messages.push(block.text);
    } else if (block.type === 'tool_use') {
      const kind = kindForToolName(block.name);
      if (!kind) {
        ignoredToolCalls += 1;
      } else if (proposals.length >= MAX_PROPOSALS) {
        tooMany = true;
      } else {
        const clean = sanitizeProposal(kind, block.input);
        if (clean) proposals.push({ kind, ...clean, confidence: clampConfidence(block.input?.confidence) });
        else skippedProposals += 1;
      }
    }
  }

  return {
    proposals,
    message: messages.join('\n').trim(),
    usage: pickUsage(response.usage),
    model: response.model,
    refused: response.stop_reason === 'refusal',
    truncated: response.stop_reason === 'max_tokens',
    ignoredToolCalls,
    skippedProposals,
    tooMany,
  };
}
