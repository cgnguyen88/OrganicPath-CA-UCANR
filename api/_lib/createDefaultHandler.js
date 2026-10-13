import Anthropic from '@anthropic-ai/sdk';
import { createClaudeHandler } from './claudeHandler.js';
import { loadConfig, resolveAnthropicKey } from './config.js';
import { createRateLimiter } from './rateLimiter.js';
import { createSupabaseTokenVerifier } from './auth.js';

const ONE_MINUTE_MS = 60_000;
const ONE_DAY_MS = 86_400_000;

/**
 * Wire the /api/claude handler from environment variables. Call this after the
 * environment is loaded (dotenv in dev; the platform injects it on Vercel).
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ error: Function, warn: Function, info: Function }} logger
 */
export function createDefaultHandler(env = process.env, logger = console) {
  const config = loadConfig(env);
  const { key, warning } = resolveAnthropicKey(env);
  if (warning) logger.warn(`[claude-proxy] ${warning}`);

  const anthropic = key ? new Anthropic({ apiKey: key }) : null;

  return createClaudeHandler({
    config,
    verifyToken: createSupabaseTokenVerifier(env),
    getAnthropic: () => anthropic,
    minuteLimiter: createRateLimiter({ max: config.rate.perMinute, windowMs: ONE_MINUTE_MS }),
    dayLimiter: createRateLimiter({ max: config.rate.perDay, windowMs: ONE_DAY_MS }),
    logger,
  });
}
