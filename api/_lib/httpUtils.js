import Anthropic from '@anthropic-ai/sdk';

export const ALLOWED_METHODS = 'POST, OPTIONS';
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;
const MAX_TOKEN_LENGTH = 4096;
// Anthropic keys, Telegram bot tokens (<digits>:<35ish chars>) and JWTs (Supabase keys and sessions).
const SECRET_PATTERN = /sk-ant-[A-Za-z0-9_-]+|\d{6,}:[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const MAX_LOGGED_MESSAGE_CHARS = 200;

/** @param {unknown} text */
export const redact = (text) =>
  String(text)
    .replace(SECRET_PATTERN, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ') // upstream text must not be able to forge log lines
    .slice(0, MAX_LOGGED_MESSAGE_CHARS);

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Grant CORS only to explicitly allowlisted origins. Same-origin calls (the
 * normal case: the SPA and /api share a host) need no CORS headers at all.
 */
export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

/** @returns {string | null} */
export function extractBearerToken(req) {
  const match = BEARER_PATTERN.exec(req.headers.authorization ?? '');
  return match && match[1].length <= MAX_TOKEN_LENGTH ? match[1] : null;
}

/**
 * Translate an upstream failure into a client-safe status and message. Upstream
 * error text is never forwarded: it can carry operational detail.
 *
 * @param {unknown} err
 * @returns {{ status: number, message: string, retryAfter?: string }}
 */
export function describeUpstreamError(err) {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: 504, message: 'The AI service took too long to respond. Please try again.' };
  }
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    switch (err.status) {
      case 429:
        return {
          status: 429,
          message: 'The AI service is busy. Please try again shortly.',
          retryAfter: err.headers?.get?.('retry-after') ?? undefined,
        };
      case 529:
        return { status: 503, message: 'The AI service is temporarily overloaded. Please try again.' };
      case 400:
        return { status: 400, message: 'The AI request was rejected. It may be too long or malformed.' };
      case 413:
        return { status: 413, message: 'The request is too large.' };
      default:
        break;
    }
  }
  return { status: 502, message: 'The AI service returned an error. Please try again.' };
}

/**
 * Apply a person's limits, then the global cap. Limiters may answer synchronously (in memory) or
 * asynchronously (shared in the database). The daily quota is only spent on requests the minute
 * limiter let through, and the global cap only on requests that passed their own limits, so a
 * client that keeps retrying a refusal cannot burn (or be locked out of) its day, or everyone's.
 *
 * @param {{ minuteLimiter: { check: Function }, dayLimiter: { check: Function }, globalLimiter?: { check: Function } }} limiters
 * @param {string} key who is asking
 * @returns {Promise<{ allowed: true } | { allowed: false, scope: 'user' | 'global', retryAfterSec: number }>}
 */
export async function checkRateLimits({ minuteLimiter, dayLimiter, globalLimiter }, key) {
  const minuteVerdict = await minuteLimiter.check(key);
  const verdicts = minuteVerdict.allowed ? [minuteVerdict, await dayLimiter.check(key)] : [minuteVerdict];
  const blocked = verdicts.filter((v) => !v.allowed);
  if (blocked.length > 0) return { allowed: false, scope: 'user', retryAfterSec: Math.max(...blocked.map((v) => v.retryAfterSec)) };

  if (globalLimiter) {
    const overall = await globalLimiter.check('all');
    if (!overall.allowed) return { allowed: false, scope: 'global', retryAfterSec: overall.retryAfterSec };
  }
  return { allowed: true };
}

/**
 * The shared front door of every authenticated POST endpoint: security headers, CORS, method,
 * bearer authentication and the per-user rate limit (invalid requests count too). The daily quota
 * is only spent on requests the minute limiter let through, so a client that keeps retrying a 429
 * cannot burn (or be locked out of) its day.
 *
 * Responds itself and resolves to `null` when the request must not continue.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{
 *   allowedOrigins: string[],
 *   verifyToken: (token: string) => Promise<{ id: string } | null>,
 *   minuteLimiter: { check: Function }, dayLimiter: { check: Function }, globalLimiter?: { check: Function },
 *   logger: { error: Function }, tag: string,
 * }} deps
 * @returns {Promise<{ user: { id: string, email?: string }, token: string } | null>}
 */
export async function guardRequest(req, res, { allowedOrigins, verifyToken, minuteLimiter, dayLimiter, globalLimiter, logger, tag }) {
  applyCors(req, res, allowedOrigins);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return null;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ALLOWED_METHODS);
    sendJson(res, 405, { error: 'Method not allowed.' });
    return null;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendJson(res, 401, { error: 'Authentication required.' });
    return null;
  }

  let user;
  try {
    user = await verifyToken(token);
  } catch (err) {
    logger.error(`[${tag}] token verification unavailable`, { reason: redact(err?.message ?? err) });
    sendJson(res, 503, { error: 'Authentication service unavailable. Please try again.' });
    return null;
  }
  if (!user?.id) {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    sendJson(res, 401, { error: 'Invalid or expired session. Please sign in again.' });
    return null;
  }

  const verdict = await checkRateLimits({ minuteLimiter, dayLimiter, globalLimiter }, user.id);
  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfterSec));
    if (verdict.scope === 'global') sendJson(res, 503, { error: 'The assistant is busy right now. Please try again later.' });
    else sendJson(res, 429, { error: 'Too many requests. Please slow down and try again shortly.' });
    return null;
  }

  return { user, token };
}
