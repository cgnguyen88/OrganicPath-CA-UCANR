import { z } from 'zod';
import { describeUpstreamError, guardRequest, redact, sendJson } from '../httpUtils.js';
import { buildReplyPatch, farmToday, presentRecord } from './captureRows.js';
import { applyReply } from './followup.js';
import { readFieldNames } from './fieldNames.js';

/** A reply only fills in a record that is still waiting for details. */
const REPLYABLE_STATUSES = ['draft', 'needs_info'];
/** Matches the records update policy: owners and managers edit anything on their farm. */
const EDITOR_ROLES = ['owner', 'manager'];

const bodySchema = z.object({
  record_id: z.uuid(),
  text: z.string(),
  lang: z.enum(['en', 'es']).optional(),
});

const UPDATE_FAILURES = {
  conflict: { status: 409, error: 'This record changed while you were answering. Reload it and try again.' },
  forbidden: { status: 403, error: 'You cannot change this record.' },
  invalid: { status: 422, error: 'That answer could not be saved to this record.' },
};

/**
 * POST /api/agent/reply — the farmer's answer to a follow-up question. The model merges the
 * answer into the STORED record (the client cannot supply the draft), the result is validated
 * again, and it is written with the caller's own session, so row-level security decides who may
 * edit what. The write is guarded by the version that was read, and never approves anything.
 *
 * @param {{
 *   config: ReturnType<import('../config.js').loadConfig>,
 *   verifyToken: Function, getAnthropic: () => object | null,
 *   store: {
 *     resolveMembership: (token: string, userId: string) => Promise<{ farmId: string, role: string } | null>,
 *     loadRecord: (token: string, id: string) => Promise<object | null>,
 *     updateRecord: (token: string, id: string, expectedVersion: number, patch: object) =>
 *       Promise<{ ok: true, row: object } | { ok: false, reason: 'conflict' | 'forbidden' | 'invalid' }>,
 *   },
 *   minuteLimiter: object, dayLimiter: object, globalLimiter?: object,
 *   logger?: { error: Function, warn: Function, info: Function },
 *   reply?: typeof applyReply, today?: () => string,
 * }} deps
 */
export function createReplyHandler({ config, verifyToken, getAnthropic, store, minuteLimiter, dayLimiter, globalLimiter, logger = console, reply = applyReply, today }) {
  const todayFn = today ?? (() => farmToday(config.agent.timeZone));

  return async function handleReply(req, res) {
    const session = await guardRequest(req, res, { allowedOrigins: config.allowedOrigins, verifyToken, minuteLimiter, dayLimiter, globalLimiter, logger, tag: 'agent-reply' });
    if (!session) return;
    const { user, token } = session;

    const parsed = bodySchema.safeParse(req.body);
    const text = parsed.success ? parsed.data.text.trim() : '';
    if (!parsed.success || text === '') {
      sendJson(res, 400, { error: 'Invalid request: expected { record_id, text, lang? }.' });
      return;
    }
    if (text.length > config.agent.limits.maxTextChars) {
      sendJson(res, 413, { error: 'That reply is too long.' });
      return;
    }
    const { record_id: recordId, lang = 'en' } = parsed.data;

    let current;
    try {
      current = await store.loadRecord(token, recordId);
    } catch (err) {
      logger.error('[agent-reply] loading the record failed', { userId: user.id, reason: redact(err?.message ?? err) });
      sendJson(res, 503, { error: 'Could not reach your farm records right now. Please try again.' });
      return;
    }
    if (!current) {
      sendJson(res, 404, { error: 'Record not found.' });
      return;
    }
    if (!REPLYABLE_STATUSES.includes(current.status)) {
      sendJson(res, 409, { error: 'This record is no longer waiting for details.' });
      return;
    }

    // Row-level security would refuse the write anyway, but only AFTER the model call has been
    // paid for: check who may edit this record first (the author, or an owner/manager).
    if (current.created_by !== user.id) {
      let membership;
      try {
        membership = await store.resolveMembership(token, user.id);
      } catch (err) {
        logger.error('[agent-reply] farm lookup failed', { userId: user.id, reason: redact(err?.message ?? err) });
        sendJson(res, 503, { error: 'Could not reach your farm records right now. Please try again.' });
        return;
      }
      if (membership?.farmId !== current.farm_id || !EDITOR_ROLES.includes(membership?.role)) {
        sendJson(res, 403, { error: UPDATE_FAILURES.forbidden.error });
        return;
      }
    }

    const anthropic = getAnthropic();
    if (!anthropic) {
      logger.error('[agent-reply] ANTHROPIC_API_KEY is not configured on the server');
      sendJson(res, 503, { error: 'The AI service is not available right now.' });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    let merged;
    try {
      merged = await reply({
        anthropic,
        config,
        draft: { kind: current.kind, record_date: current.record_date, payload: current.payload },
        replyText: text,
        allowedKeys: current.missing_fields ?? [],
        today: todayFn(),
        signal: controller.signal,
        fieldNames: await readFieldNames(store.listFieldNames ? () => store.listFieldNames(token, { farmId: current.farm_id }) : undefined, logger),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const { status, message, retryAfter } = describeUpstreamError(err);
      logger.error('[agent-reply] merge failed', { userId: user.id, upstreamStatus: err?.status, errorName: err?.name, detail: redact(err?.message ?? err) });
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      sendJson(res, status, { error: message });
      return;
    }

    const { evaluation, applied, rejected, message } = merged;
    const outcome = { applied, rejected, message };

    if (!evaluation?.ok) {
      sendJson(res, 422, { error: UPDATE_FAILURES.invalid.error });
      return;
    }
    if (applied.length === 0) {
      sendJson(res, 200, { record: presentRecord(current, lang), ...outcome });
      return;
    }

    const patch = buildReplyPatch(current.kind, evaluation);

    let result;
    try {
      result = await store.updateRecord(token, recordId, current.version, patch);
    } catch (err) {
      logger.error('[agent-reply] saving failed', { userId: user.id, code: err?.code, reason: redact(err?.message ?? err) });
      sendJson(res, 500, { error: 'Could not save your answer. Please try again.' });
      return;
    }
    if (!result.ok) {
      const failure = UPDATE_FAILURES[result.reason] ?? UPDATE_FAILURES.invalid;
      sendJson(res, failure.status, { error: failure.error });
      return;
    }

    sendJson(res, 200, { record: presentRecord(result.row, lang), ...outcome });
  };
}
