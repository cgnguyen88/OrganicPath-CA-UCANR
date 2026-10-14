import Anthropic from '@anthropic-ai/sdk';
import { createClaudeHandler } from './claudeHandler.js';
import { loadConfig, resolveAnthropicKey } from './config.js';
import { createSupabaseTokenVerifier } from './auth.js';
import { createLimiterSet } from './limiters.js';
import { createAgentStore } from './agent/supabaseStore.js';

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
  const limiters = createLimiterSet({
    rate: config.rate,
    prefix: 'claude',
    store: createAgentStore(env),
    // Shared counts need the server role; without it limits are per serverless instance.
    shared: Boolean(env.SUPABASE_SERVICE_ROLE_KEY && (env.SUPABASE_URL || env.VITE_SUPABASE_URL)),
    logger,
  });

  return createClaudeHandler({
    config,
    verifyToken: createSupabaseTokenVerifier(env),
    getAnthropic: () => anthropic,
    ...limiters.forEndpoint('proxy'),
    globalLimiter: limiters.global,
    logger,
  });
}
