const WARN_EVERY_MS = 60_000;

/**
 * A rate limiter whose counts live in Postgres, so every serverless instance shares them.
 * If the database cannot be reached it falls back to the per-instance limiter instead of failing
 * the request (cost protection degrades; the service does not go down).
 *
 * @param {{
 *   bucket: string, max: number, windowMs: number,
 *   takeToken: (bucket: string, subject: string, max: number, windowSeconds: number) => Promise<{ allowed: boolean, retry_after_sec: number }>,
 *   fallback: { check: (key: string) => { allowed: boolean, retryAfterSec: number } },
 *   logger: { warn: Function },
 *   now?: () => number,
 * }} options
 */
export function createDurableRateLimiter({ bucket, max, windowMs, takeToken, fallback, logger, now = Date.now }) {
  const windowSeconds = Math.ceil(windowMs / 1000);
  let lastWarnAt = -Infinity;

  /** @param {string} key @returns {Promise<{ allowed: boolean, remaining: number | null, retryAfterSec: number }>} */
  async function check(key) {
    try {
      const verdict = await takeToken(bucket, key, max, windowSeconds);
      if (typeof verdict?.allowed !== 'boolean') throw new Error('Malformed rate limit verdict.');
      return { allowed: verdict.allowed, remaining: null, retryAfterSec: verdict.allowed ? 0 : Math.max(1, Number(verdict.retry_after_sec) || 1) };
    } catch (err) {
      const at = now();
      if (at - lastWarnAt >= WARN_EVERY_MS) {
        lastWarnAt = at;
        // No error text: it can carry connection details. The name and code are enough to investigate.
        logger.warn('[rate-limit] shared limiter unavailable; using per-instance limits for now', { bucket, errorName: err?.name, code: err?.code });
      }
      return fallback.check(key);
    }
  }

  return { check };
}
