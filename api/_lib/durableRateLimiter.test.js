import { describe, it, expect, vi } from 'vitest';
import { createDurableRateLimiter } from './durableRateLimiter.js';
import { createRateLimiter } from './rateLimiter.js';

const logger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });

describe('createDurableRateLimiter', () => {
  it('asks the database for a token in whole seconds and returns its verdict', async () => {
    const takeToken = vi.fn(async () => ({ allowed: true, retry_after_sec: 0 }));
    const limiter = createDurableRateLimiter({ bucket: 'agent-min', max: 6, windowMs: 60_000, takeToken, fallback: createRateLimiter({ max: 1, windowMs: 1000 }), logger: logger() });
    expect(await limiter.check('user-1')).toMatchObject({ allowed: true, retryAfterSec: 0 });
    expect(takeToken).toHaveBeenCalledWith('agent-min', 'user-1', 6, 60);
  });

  it('rounds the window up so a sub-second remainder never shortens it', async () => {
    const takeToken = vi.fn(async () => ({ allowed: true, retry_after_sec: 0 }));
    const limiter = createDurableRateLimiter({ bucket: 'b', max: 1, windowMs: 1500, takeToken, fallback: createRateLimiter({ max: 1, windowMs: 1000 }), logger: logger() });
    await limiter.check('u');
    expect(takeToken.mock.calls[0][3]).toBe(2);
  });

  it('reports a block with the wait the database computed', async () => {
    const takeToken = vi.fn(async () => ({ allowed: false, retry_after_sec: 42 }));
    const limiter = createDurableRateLimiter({ bucket: 'b', max: 1, windowMs: 60_000, takeToken, fallback: createRateLimiter({ max: 5, windowMs: 1000 }), logger: logger() });
    expect(await limiter.check('u')).toMatchObject({ allowed: false, retryAfterSec: 42 });
  });

  it('falls back to the in-memory limiter when the database is unreachable, instead of failing the request', async () => {
    const takeToken = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.1'); });
    const log = logger();
    const limiter = createDurableRateLimiter({ bucket: 'b', max: 2, windowMs: 60_000, takeToken, fallback: createRateLimiter({ max: 2, windowMs: 60_000 }), logger: log });
    expect((await limiter.check('u')).allowed).toBe(true);
    expect((await limiter.check('u')).allowed).toBe(true);
    expect((await limiter.check('u')).allowed).toBe(false); // the fallback still enforces a limit
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('10.0.0.1');
  });

  it('warns once, not on every failing request', async () => {
    const log = logger();
    const limiter = createDurableRateLimiter({ bucket: 'b', max: 99, windowMs: 60_000, takeToken: async () => { throw new Error('down'); }, fallback: createRateLimiter({ max: 99, windowMs: 60_000 }), logger: log });
    for (let i = 0; i < 6; i += 1) await limiter.check('u');
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('treats a malformed database answer as a failure (falls back) rather than as permission', async () => {
    const limiter = createDurableRateLimiter({ bucket: 'b', max: 1, windowMs: 60_000, takeToken: async () => ({}), fallback: createRateLimiter({ max: 1, windowMs: 60_000 }), logger: logger() });
    expect((await limiter.check('u')).allowed).toBe(true);
    expect((await limiter.check('u')).allowed).toBe(false);
  });
});
