import Anthropic from '@anthropic-ai/sdk';
import { validateClaudeRequest } from './validateRequest.js';
import { describeUpstreamError, guardRequest, redact, sendJson } from './httpUtils.js';

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
 *   globalLimiter?: { check: Function },
 *   logger?: { error: Function, warn: Function, info: Function },
 * }} deps
 * @returns {(req: import('node:http').IncomingMessage & { body?: unknown }, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createClaudeHandler({ config, verifyToken, getAnthropic, minuteLimiter, dayLimiter, globalLimiter, logger = console }) {
  return async function handleClaudeRequest(req, res) {
    const session = await guardRequest(req, res, {
      allowedOrigins: config.allowedOrigins, verifyToken, minuteLimiter, dayLimiter, globalLimiter, logger, tag: 'claude-proxy',
    });
    if (!session) return;
    const { user } = session;

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
