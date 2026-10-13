import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './rateLimiter.js';

describe('createRateLimiter', () => {
  it('allows up to max requests per window, then blocks with a retry hint', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000, now: () => now });

    expect(limiter.check('u1')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check('u1')).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = limiter.check('u1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
  });

  it('frees capacity as old requests leave the window (sliding)', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000, now: () => now });
    limiter.check('u1'); // t=0
    now = 30_000;
    limiter.check('u1'); // t=30s
    now = 59_000;
    const blocked = limiter.check('u1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(1); // first request leaves at t=60s

    now = 60_001;
    expect(limiter.check('u1').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('does not count blocked attempts against the window', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    limiter.check('a');
    for (let i = 0; i < 50; i += 1) limiter.check('a'); // hammering while blocked
    now = 1001;
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('forgets idle keys so memory does not grow without bound', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    limiter.check('a');
    limiter.check('b');
    expect(limiter.size()).toBe(2);
    now = 5000;
    limiter.sweep();
    expect(limiter.size()).toBe(0);
  });
});
