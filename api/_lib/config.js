/**
 * Server-side configuration for the Claude proxy. Everything here is read from
 * environment variables on the server; nothing is controllable by the client.
 */

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const HARD_MAX_OUTPUT_TOKENS = 16_000;
const DEFAULT_MAX_INPUT_CHARS = 200_000;
const DEFAULT_MAX_SYSTEM_CHARS = 20_000;
const DEFAULT_MAX_MESSAGES = 40;
// The UI allows 15 MB attachments; base64 inflates them by 4/3.
const DEFAULT_MAX_ATTACHMENT_CHARS = Math.ceil((15 * 1024 * 1024 * 4) / 3) + 1024;
const DEFAULT_MAX_ATTACHMENTS = 4;
const DEFAULT_MAX_TOTAL_ATTACHMENT_CHARS = DEFAULT_MAX_ATTACHMENT_CHARS * 2;
const BODY_OVERHEAD_BYTES = 1_048_576; // JSON framing, role/type keys, system prompt
const DEFAULT_RATE_PER_MINUTE = 20;
const DEFAULT_RATE_PER_DAY = 400;
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  const limits = Object.freeze({
    maxMessages: positiveInt(env.AI_MAX_MESSAGES, DEFAULT_MAX_MESSAGES),
    maxTotalChars: positiveInt(env.AI_MAX_INPUT_CHARS, DEFAULT_MAX_INPUT_CHARS),
    maxSystemChars: positiveInt(env.AI_MAX_SYSTEM_CHARS, DEFAULT_MAX_SYSTEM_CHARS),
    maxAttachments: positiveInt(env.AI_MAX_ATTACHMENTS, DEFAULT_MAX_ATTACHMENTS),
    maxAttachmentChars: positiveInt(env.AI_MAX_ATTACHMENT_CHARS, DEFAULT_MAX_ATTACHMENT_CHARS),
    maxTotalAttachmentChars: positiveInt(env.AI_MAX_TOTAL_ATTACHMENT_CHARS, DEFAULT_MAX_TOTAL_ATTACHMENT_CHARS),
  });

  return Object.freeze({
    model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    maxOutputTokens: Math.min(positiveInt(env.AI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS), HARD_MAX_OUTPUT_TOKENS),
    requestTimeoutMs: positiveInt(env.AI_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    rate: Object.freeze({
      perMinute: positiveInt(env.AI_RATE_LIMIT_PER_MIN, DEFAULT_RATE_PER_MINUTE),
      perDay: positiveInt(env.AI_RATE_LIMIT_PER_DAY, DEFAULT_RATE_PER_DAY),
    }),
    limits,
    // HTTP body cap for servers that parse JSON themselves (the local Express dev server).
    bodyLimitBytes: limits.maxTotalChars + limits.maxTotalAttachmentChars + BODY_OVERHEAD_BYTES,
  });
}

/**
 * Pick the Anthropic API key. `VITE_`-prefixed variables are inlined into the
 * browser bundle by Vite, so a key stored that way is public: it is never used,
 * and its presence produces a warning telling the operator to rotate it.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ key: string | null, warning: string | null }}
 */
export function resolveAnthropicKey(env = process.env) {
  const key = env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || null;
  const warning = env.VITE_ANTHROPIC_API_KEY
    ? 'VITE_ANTHROPIC_API_KEY is set. Variables with the VITE_ prefix are bundled into the browser build and are public, so it is ignored. Rotate that key in the Anthropic console and store the replacement as ANTHROPIC_API_KEY (no VITE_ prefix).'
    : null;
  return { key, warning };
}
