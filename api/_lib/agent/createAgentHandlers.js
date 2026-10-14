import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, resolveAnthropicKey } from '../config.js';
import { createSupabaseTokenVerifier } from '../auth.js';
import { createCaptureHandler } from './captureHandler.js';
import { createMaterialHandler } from './materialHandler.js';
import { createReplyHandler } from './replyHandler.js';
import { createAgentStore } from './supabaseStore.js';
import { createAgentLimiters } from '../limiters.js';
import { createTelegramHandler } from '../channels/createTelegramHandler.js';

/**
 * Wire the farm-records agent endpoints from environment variables. Call after the environment
 * is loaded (dotenv in dev; the platform injects it on Vercel).
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ error: Function, warn: Function, info: Function }} logger
 * @returns {{ capture: Function, reply: Function, material: Function, telegram: Function }}
 */
export function createAgentHandlers(env = process.env, logger = console) {
  const config = loadConfig(env);
  const { key, warning } = resolveAnthropicKey(env);
  if (warning) logger.warn(`[agent] ${warning}`);

  if (env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn('[agent] VITE_SUPABASE_SERVICE_ROLE_KEY is set. Variables with the VITE_ prefix are bundled into the browser build and are public, and the service-role key bypasses every row-level security policy. Rotate that key in the Supabase dashboard now and store the replacement as SUPABASE_SERVICE_ROLE_KEY (no VITE_ prefix).');
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn('[agent] SUPABASE_SERVICE_ROLE_KEY is not set: captured records cannot be saved until it is (server-side only, never VITE_).');
  }

  const anthropic = key ? new Anthropic({ apiKey: key }) : null;
  const store = createAgentStore(env);
  const limiters = createAgentLimiters({
    config,
    store,
    // Shared counts need the server role (the limit table is closed to everyone else).
    shared: Boolean(env.SUPABASE_SERVICE_ROLE_KEY && (env.SUPABASE_URL || env.VITE_SUPABASE_URL)),
    logger,
  });
  const shared = {
    config,
    verifyToken: createSupabaseTokenVerifier(env),
    getAnthropic: () => anthropic,
    store,
    globalLimiter: limiters.global,
    logger,
  };

  return {
    capture: createCaptureHandler({ ...shared, ...limiters.forEndpoint('capture') }),
    reply: createReplyHandler({ ...shared, ...limiters.forEndpoint('reply') }),
    material: createMaterialHandler({ ...shared, ...limiters.forEndpoint('material') }),
    telegram: createTelegramHandler({ env, config, anthropic, agentStore: store, limiters, logger }),
  };
}
