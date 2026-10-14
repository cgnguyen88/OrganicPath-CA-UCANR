import { z } from 'zod';
import { describeUpstreamError, guardRequest, redact, sendJson } from '../httpUtils.js';
import { farmToday } from './captureRows.js';
import { checkMaterial } from './materialCheck.js';

const MAX_MATERIAL_CHARS = 120;
const MAX_USE_CHARS = 200;
const SEARCH_RESULT_LIMIT = 6;
// C0 controls except tab and newline, plus DEL.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const bodySchema = z.object({
  material: z.string(),
  use: z.string().optional(),
  lang: z.enum(['en', 'es']).optional(),
});

const clean = (text) => text.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();

/**
 * POST /api/agent/check-material — "is this material OK under 7 CFR 205?", answered with
 * citations from the regulation text. Signed-in users only; the regulation search runs with the
 * caller's own session. Nothing about the question is logged.
 *
 * @param {{
 *   config: ReturnType<import('../config.js').loadConfig>,
 *   verifyToken: Function, getAnthropic: () => object | null,
 *   store: { searchRegulations: (token: string, query: string, limit?: number) => Promise<object[]> },
 *   minuteLimiter: object, dayLimiter: object, globalLimiter?: object,
 *   logger?: { error: Function, warn: Function, info: Function },
 *   check?: typeof checkMaterial, today?: () => string,
 * }} deps
 */
export function createMaterialHandler({ config, verifyToken, getAnthropic, store, minuteLimiter, dayLimiter, globalLimiter, logger = console, check = checkMaterial, today }) {
  const todayFn = today ?? (() => farmToday(config.agent.timeZone));

  return async function handleMaterialCheck(req, res) {
    const session = await guardRequest(req, res, { allowedOrigins: config.allowedOrigins, verifyToken, minuteLimiter, dayLimiter, globalLimiter, logger, tag: 'agent-material' });
    if (!session) return;
    const { user, token } = session;

    const parsed = bodySchema.safeParse(req.body);
    const material = parsed.success ? clean(parsed.data.material) : '';
    if (!parsed.success || material === '') {
      sendJson(res, 400, { error: 'Invalid request: expected { material, use?, lang? }.' });
      return;
    }
    const use = clean(parsed.data.use ?? '');
    if (material.length > MAX_MATERIAL_CHARS || use.length > MAX_USE_CHARS) {
      sendJson(res, 413, { error: 'That is too long.' });
      return;
    }

    const anthropic = getAnthropic();
    if (!anthropic) {
      logger.error('[agent-material] ANTHROPIC_API_KEY is not configured on the server');
      sendJson(res, 503, { error: 'The AI service is not available right now.' });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    let outcome;
    try {
      outcome = await check({
        anthropic,
        config,
        search: (query) => store.searchRegulations(token, query, SEARCH_RESULT_LIMIT),
        input: { material, use },
        today: todayFn(),
        lang: parsed.data.lang ?? 'en',
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const { status, message, retryAfter } = describeUpstreamError(err);
      logger.error('[agent-material] check failed', { userId: user.id, upstreamStatus: err?.status, errorName: err?.name, detail: redact(err?.message ?? err) });
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      sendJson(res, status, { error: message });
      return;
    }

    logger.info('[agent-material] checked', { userId: user.id, verdict: outcome.verdict, searches: outcome.searches, usage: outcome.usage });
    const { usage: _usage, ...result } = outcome;
    // Whatever the verdict, the answer is a pointer to the text, not a certification decision.
    sendJson(res, 200, { result, reminder: 'confirm_with_certifier' });
  };
}
