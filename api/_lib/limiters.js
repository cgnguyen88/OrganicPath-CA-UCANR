import { createRateLimiter } from './rateLimiter.js';
import { createDurableRateLimiter } from './durableRateLimiter.js';

const ONE_MINUTE_MS = 60_000;
const ONE_DAY_MS = 86_400_000;

/**
 * Per-user limits for each endpoint of a family (for example the agent's), plus one global daily
 * cap shared by that family. With `shared`, counts live in Postgres (every serverless instance sees
 * them) and quietly fall back to per-instance counting if the database is unreachable; without it,
 * counts are per instance.
 *
 * @param {{
 *   rate: { perMinute: number, perDay: number, globalPerDay: number },
 *   prefix: string,
 *   store: { takeRateToken: Function },
 *   shared: boolean,
 *   logger: { warn: Function },
 * }} deps
 */
export function createLimiterSet({ rate, prefix, store, shared, logger }) {
  const build = (bucket, max, windowMs) => {
    const local = createRateLimiter({ max, windowMs });
    return shared ? createDurableRateLimiter({ bucket, max, windowMs, takeToken: store.takeRateToken, fallback: local, logger }) : local;
  };

  return {
    /** A one-off limiter (for example "5 replies per hour to strangers"), shared or per instance like the rest. */
    single: (bucket, max, windowMs) => build(`${prefix}-${bucket}`, max, windowMs),
    forEndpoint: (name) => ({
      minuteLimiter: build(`${prefix}-${name}-min`, rate.perMinute, ONE_MINUTE_MS),
      dayLimiter: build(`${prefix}-${name}-day`, rate.perDay, ONE_DAY_MS),
    }),
    global: build(`${prefix}-global-day`, rate.globalPerDay, ONE_DAY_MS),
  };
}

/** The farm-records agent's limits (config.agent.rate). */
export const createAgentLimiters = ({ config, ...rest }) => createLimiterSet({ rate: config.agent.rate, prefix: 'agent', ...rest });
