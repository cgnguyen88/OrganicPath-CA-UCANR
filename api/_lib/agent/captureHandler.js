import { z } from 'zod';
import { attachmentBlockSchema } from '../validateRequest.js';
import { describeUpstreamError, guardRequest, redact, sendJson } from '../httpUtils.js';
import { farmToday, presentRecord } from './captureRows.js';
import { PipelineError, runCapture } from './capturePipeline.js';
import { extractRecords } from './extract.js';

// C0 controls except tab and newline, plus DEL. A NUL would make Postgres reject the whole record.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const bodySchema = z.object({
  text: z.string().optional(),
  attachments: z.array(attachmentBlockSchema).optional(),
  lang: z.enum(['en', 'es']).optional(),
});

/**
 * Validate a capture request. Only text, files and language are read; anything else the client
 * sends (model, system prompt, tools, farm, status, author, ...) is dropped.
 */
function validateCapture(body, config) {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: 'Invalid request: expected { text?, attachments?, lang? }.' };

  const text = (parsed.data.text ?? '').replace(CONTROL_CHARS, '').trim();
  const attachments = parsed.data.attachments ?? [];
  const lang = parsed.data.lang ?? 'en';
  if (text === '' && attachments.length === 0) return { ok: false, status: 400, error: 'Send some text or a photo to read.' };

  if (text.length > config.agent.limits.maxTextChars) return { ok: false, status: 413, error: 'That message is too long.' };
  if (attachments.length > config.agent.limits.maxAttachments) return { ok: false, status: 413, error: 'Too many files in one message.' };
  const sizes = attachments.map((file) => file.source.data.length);
  if (sizes.some((size) => size > config.agent.limits.maxAttachmentChars)) return { ok: false, status: 413, error: 'A file is too large.' };
  if (sizes.reduce((sum, size) => sum + size, 0) > config.agent.limits.maxTotalAttachmentChars) {
    return { ok: false, status: 413, error: 'The files are too large.' };
  }
  return { ok: true, value: { text, attachments, lang } };
}

const duplicateResponse = (rows, lang) => ({ duplicate: true, records: rows.map((row) => presentRecord(row, lang)), message: '', warnings: [] });

/**
 * POST /api/agent/capture — read a message and/or photo and file the records it contains
 * for review. Order: front door (auth + rate limit), validation, farm membership, duplicate
 * check, model, save.
 *
 * @param {{
 *   config: ReturnType<import('../config.js').loadConfig>,
 *   verifyToken: (token: string) => Promise<{ id: string } | null>,
 *   getAnthropic: () => object | null,
 *   store: {
 *     resolveMembership: (token: string, userId: string) => Promise<{ farmId: string, role: string } | null>,
 *     findCapture: (token: string, q: { farmId: string, captureHash: string }) => Promise<object[]>,
 *     uploadAttachments: (q: { farmId: string, captureHash: string, attachments: object[] }) => Promise<object[]>,
 *     insertRecords: (rows: object[]) => Promise<object[]>,
 *     listFieldNames?: (token: string, q: { farmId: string }) => Promise<string[]>,
 *   },
 *   minuteLimiter: object, dayLimiter: object, globalLimiter?: object,
 *   logger?: { error: Function, warn: Function, info: Function },
 *   extract?: typeof extractRecords,
 *   today?: () => string,
 * }} deps
 */
export function createCaptureHandler({ config, verifyToken, getAnthropic, store, minuteLimiter, dayLimiter, globalLimiter, logger = console, extract = extractRecords, today }) {
  const todayFn = today ?? (() => farmToday(config.agent.timeZone));

  return async function handleCapture(req, res) {
    const session = await guardRequest(req, res, { allowedOrigins: config.allowedOrigins, verifyToken, minuteLimiter, dayLimiter, globalLimiter, logger, tag: 'agent-capture' });
    if (!session) return;
    const { user, token } = session;

    const validation = validateCapture(req.body, config);
    if (!validation.ok) {
      sendJson(res, validation.status, { error: validation.error });
      return;
    }
    const { text, attachments, lang } = validation.value;

    // ── Which farm? From the session, never from the request ────────────────
    let membership;
    try {
      membership = await store.resolveMembership(token, user.id);
    } catch (err) {
      logger.error('[agent-capture] farm lookup failed', { userId: user.id, reason: redact(err?.message ?? err) });
      sendJson(res, 503, { error: 'Could not reach your farm records right now. Please try again.' });
      return;
    }
    if (!membership) {
      sendJson(res, 403, { error: 'Your account is not part of a farm yet.' });
      return;
    }
    const { farmId } = membership;

    const anthropic = getAnthropic();
    if (!anthropic) {
      logger.error('[agent-capture] ANTHROPIC_API_KEY is not configured on the server');
      sendJson(res, 503, { error: 'The AI service is not available right now.' });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    let outcome;
    try {
      outcome = await runCapture({
        ports: {
          findCapture: (captureHash) => store.findCapture(token, { farmId, captureHash }),
          uploadAttachments: ({ captureHash, attachments: files }) => store.uploadAttachments({ farmId, captureHash, attachments: files }),
          insertRecords: (rows) => store.insertRecords(rows),
          listFieldNames: store.listFieldNames ? () => store.listFieldNames(token, { farmId }) : undefined,
        },
        extract, anthropic, config, userId: user.id, farmId, text, attachments, day: todayFn(), logger, signal: controller.signal,
      });
    } catch (err) {
      if (!(err instanceof PipelineError)) throw err;
      if (err.stage === 'lookup') {
        logger.error('[agent-capture] duplicate check failed', { userId: user.id, reason: redact(err.cause?.message ?? err.cause) });
        sendJson(res, 503, { error: 'Could not reach your farm records right now. Please try again.' });
      } else if (err.stage === 'extract') {
        if (controller.signal.aborted) return; // client went away
        const { status, message, retryAfter } = describeUpstreamError(err.cause);
        logger.error('[agent-capture] extraction failed', { userId: user.id, upstreamStatus: err.cause?.status, errorName: err.cause?.name, detail: redact(err.cause?.message ?? err.cause) });
        if (retryAfter) res.setHeader('Retry-After', retryAfter);
        sendJson(res, status, { error: message });
      } else {
        logger.error('[agent-capture] saving records failed', { userId: user.id, farmId, code: err.cause?.code, reason: redact(err.cause?.message ?? err.cause) });
        sendJson(res, 500, { error: 'Could not save the records. Please try again.' });
      }
      return;
    }

    if (outcome.outcome === 'duplicate') {
      sendJson(res, 200, duplicateResponse(outcome.rows, lang));
    } else if (outcome.outcome === 'empty') {
      sendJson(res, 200, { records: [], message: outcome.message, refused: outcome.refused, ...outcome.flags });
    } else {
      sendJson(res, 200, { records: outcome.rows.map((row) => presentRecord(row, lang)), message: outcome.message, refused: false, warnings: outcome.warnings, ...outcome.flags });
    }
  };
}
