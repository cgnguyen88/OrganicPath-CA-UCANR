const SWEEP_EVERY_N_CHECKS = 500;

/**
 * In-memory sliding-window limiter. State is per server instance, so on
 * serverless platforms it is a best-effort brake, not an exact global quota.
 * Blocked attempts are not recorded, so hammering cannot extend a lockout.
 *
 * @param {{ max: number, windowMs: number, now?: () => number }} options
 */
export function createRateLimiter({ max, windowMs, now = Date.now }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  let checks = 0;

  const recentHits = (key, at) => (hits.get(key) ?? []).filter((ts) => ts > at - windowMs);

  function sweep() {
    const at = now();
    for (const key of [...hits.keys()]) {
      const recent = recentHits(key, at);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  }

  /**
   * @param {string} key
   * @returns {{ allowed: boolean, remaining: number, retryAfterSec: number }}
   */
  function check(key) {
    checks += 1;
    if (checks % SWEEP_EVERY_N_CHECKS === 0) sweep();

    const at = now();
    const recent = recentHits(key, at);

    if (recent.length >= max) {
      hits.set(key, recent);
      const retryAfterMs = recent[0] + windowMs - at;
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    const next = [...recent, at];
    hits.set(key, next);
    return { allowed: true, remaining: max - next.length, retryAfterSec: 0 };
  }

  return { check, sweep, size: () => hits.size };
}
