import { z } from 'zod';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const textBlock = z.object({ type: z.literal('text'), text: z.string().min(1) });

// Attachments are inline base64 only. URL and file_id sources are rejected so the
// upstream service can never be pointed at an address the client chose.
const imageBlock = z.object({
  type: z.literal('image'),
  source: z.object({ type: z.literal('base64'), media_type: z.enum(IMAGE_TYPES), data: z.string().min(1) }),
});
const documentBlock = z.object({
  type: z.literal('document'),
  source: z.object({ type: z.literal('base64'), media_type: z.literal('application/pdf'), data: z.string().min(1) }),
});

const userContent = z.union([z.string().min(1), z.array(z.union([textBlock, imageBlock, documentBlock])).min(1)]);
const assistantContent = z.union([z.string().min(1), z.array(textBlock).min(1)]);

const messageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: userContent }),
  z.object({ role: z.literal('assistant'), content: assistantContent }),
]);

// Unknown keys (model, max_tokens, tools, temperature, cache_control, ...) are stripped: the
// client may only supply the conversation, an optional system prompt, and stream.
const requestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  system: z.string().optional(),
  stream: z.boolean().optional(),
});

/**
 * Split a message's content into text characters and attachment characters.
 * @param {string | Array<{ type: string, text?: string, source?: { data: string } }>} content
 * @returns {{ textChars: number, attachmentSizes: number[] }}
 */
function measure(content) {
  if (typeof content === 'string') return { textChars: content.length, attachmentSizes: [] };
  let textChars = 0;
  const attachmentSizes = [];
  for (const block of content) {
    if (block.type === 'text') textChars += block.text.length;
    else attachmentSizes.push(block.source.data.length);
  }
  return { textChars, attachmentSizes };
}

const reject = (status, error) => ({ ok: false, status, error });

/**
 * Validate and sanitize a /api/claude request body.
 *
 * @param {unknown} body
 * @param {{ maxMessages: number, maxTotalChars: number, maxSystemChars: number,
 *   maxAttachments: number, maxAttachmentChars: number, maxTotalAttachmentChars: number }} limits
 * @returns {{ ok: true, value: { messages: Array<{ role: string, content: unknown }>, system: string | undefined, stream: boolean } }
 *   | { ok: false, status: 400 | 413, error: string }}
 */
export function validateClaudeRequest(body, limits) {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return reject(400, 'Invalid request: expected { messages: [{ role, content }], system?, stream? }.');
  }

  const { messages, system, stream } = parsed.data;

  if (messages[0].role !== 'user') {
    return reject(400, 'Invalid request: the first message must be from the user.');
  }
  if (messages.length > limits.maxMessages) return reject(413, 'Too many messages in one request.');
  if (system !== undefined && system.length > limits.maxSystemChars) return reject(413, 'System prompt is too large.');

  let textChars = system?.length ?? 0;
  const attachmentSizes = [];
  for (const message of messages) {
    const measured = measure(message.content);
    textChars += measured.textChars;
    attachmentSizes.push(...measured.attachmentSizes);
  }

  if (textChars > limits.maxTotalChars) return reject(413, 'Request is too large.');
  if (attachmentSizes.length > limits.maxAttachments) return reject(413, 'Too many attachments in one request.');
  if (attachmentSizes.some((size) => size > limits.maxAttachmentChars)) return reject(413, 'Attachment is too large.');
  if (attachmentSizes.reduce((sum, size) => sum + size, 0) > limits.maxTotalAttachmentChars) {
    return reject(413, 'Attachments are too large.');
  }

  return { ok: true, value: { messages, system, stream: stream === true } };
}
