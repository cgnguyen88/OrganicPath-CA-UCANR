import Anthropic from '@anthropic-ai/sdk';
import { validateClaudeRequest } from './validateRequest.js';

const ALLOWED_METHODS = 'POST, OPTIONS';
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;
const MAX_TOKEN_LENGTH = 4096;
const SECRET_PATTERN = /sk-ant-[A-Za-z0-9_-]+/g;
const MAX_LOGGED_MESSAGE_CHARS = 200;

/** @param {string} text */
const redact = (text) =>
  String(text)
    .replace(SECRET_PATTERN, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ') // upstream text must not be able to forge log lines
    .slice(0, MAX_LOGGED_MESSAGE_CHARS);

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/**
 * Grant CORS only to explicitly allowlisted origins. Same-origin calls (the
 * normal case: the SPA and /api share a host) need no CORS headers at all.
 */
function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

/** @returns {string | null} */
function extractBearerToken(req) {
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
function describeUpstreamError(err) {
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
 * Create the /api/claude request handler. It runs unchanged on Vercel
 * serverless functions and on the local Express dev server.
 *
 * Order of checks: method, CORS, authentication, rate limit, validation,
 * configuration, upstream call. Anonymous callers learn nothing about server
 * configuration, and invalid requests still spend quota.
 *
 * @param {{
 *   config: ReturnType<import('./config.js').loadConfig>,
 *   verifyToken: (token: string) => Promise<{ id: string } | null>,
 *   getAnthropic: () => Anthropic | null,
 *   minuteLimiter: ReturnType<import('./rateLimiter.js').createRateLimiter>,
 *   dayLimiter: ReturnType<import('./rateLimiter.js').createRateLimiter>,
 *   logger?: { error: Function, warn: Function, info: Function },
 * }} deps
 * @returns {(req: import('node:http').IncomingMessage & { body?: unknown }, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createClaudeHandler({ config, verifyToken, getAnthropic, minuteLimiter, dayLimiter, logger = console }) {
  return async function handleClaudeRequest(req, res) {
    applyCors(req, res, config.allowedOrigins);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', ALLOWED_METHODS);
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    // ── Authentication ──────────────────────────────────────────────────────
    const token = extractBearerToken(req);
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendJson(res, 401, { error: 'Authentication required.' });
      return;
    }

    let user;
    try {
      user = await verifyToken(token);
    } catch (err) {
      logger.error('[claude-proxy] token verification unavailable', { reason: redact(err?.message ?? err) });
      sendJson(res, 503, { error: 'Authentication service unavailable. Please try again.' });
      return;
    }
    if (!user?.id) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      sendJson(res, 401, { error: 'Invalid or expired session. Please sign in again.' });
      return;
    }

    // ── Rate limit (counts invalid requests too) ────────────────────────────
    // Daily quota is only spent on requests the minute limiter let through, so a
    // client that keeps retrying a 429 cannot burn (or be locked out of) its day.
    const minuteVerdict = minuteLimiter.check(user.id);
    const verdicts = minuteVerdict.allowed ? [minuteVerdict, dayLimiter.check(user.id)] : [minuteVerdict];
    const blocked = verdicts.filter((v) => !v.allowed);
    if (blocked.length > 0) {
      res.setHeader('Retry-After', String(Math.max(...blocked.map((v) => v.retryAfterSec))));
      sendJson(res, 429, { error: 'Too many requests. Please slow down and try again shortly.' });
      return;
    }

    // ── Validation ──────────────────────────────────────────────────────────
    const validation = validateClaudeRequest(req.body, config.limits);
    if (!validation.ok) {
      sendJson(res, validation.status, { error: validation.error });
      return;
    }
    const { messages, system, stream } = validation.value;

    // ── Configuration ───────────────────────────────────────────────────────
    const anthropic = getAnthropic();
    if (!anthropic) {
      logger.error('[claude-proxy] ANTHROPIC_API_KEY is not configured on the server');
      sendJson(res, 503, { error: 'The AI service is not available right now.' });
      return;
    }

    // ── Upstream call ───────────────────────────────────────────────────────
    const params = {
      model: config.model,
      max_tokens: config.maxOutputTokens,
      messages,
      ...(system ? { system } : {}),
    };
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const options = { signal: controller.signal, timeout: config.requestTimeoutMs };

    let streamStarted = false;
    try {
      if (stream) {
        const upstream = anthropic.messages.stream(params, options);

        // Commit to SSE only once real output arrives, so an upstream failure
        // before that can still be reported with a proper HTTP status.
        const startSse = () => {
          if (streamStarted) return;
          streamStarted = true;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('X-Model-Used', config.model);
        };

        upstream.on('text', (delta) => {
          startSse();
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
        });

        const final = await upstream.finalMessage();
        startSse();
        if (final.stop_reason === 'max_tokens') {
          logger.warn('[claude-proxy] response truncated by max_tokens', { userId: user.id, maxTokens: config.maxOutputTokens });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const message = await anthropic.messages.create(params, options);
      if (message.stop_reason === 'max_tokens') {
        logger.warn('[claude-proxy] response truncated by max_tokens', { userId: user.id, maxTokens: config.maxOutputTokens });
      }
      res.setHeader('X-Model-Used', config.model);
      sendJson(res, 200, message);
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || controller.signal.aborted) return; // client went away

      const { status, message, retryAfter } = describeUpstreamError(err);
      logger.error('[claude-proxy] upstream request failed', {
        userId: user.id,
        upstreamStatus: err?.status,
        errorName: err?.name,
        detail: redact(err?.message ?? err),
      });

      if (streamStarted) {
        // Abort the connection instead of ending it cleanly. A clean end would look like a
        // complete answer to every client, which would then keep a truncated result.
        res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`, () => res.destroy());
        return;
      }
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      sendJson(res, status, { error: message });
    }
  };
}
