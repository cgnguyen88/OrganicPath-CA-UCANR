import { describe, it, expect, vi } from 'vitest';
import { createAgentLimiters, createLimiterSet } from './limiters.js';

const config = { agent: { rate: { perMinute: 2, perDay: 3, globalPerDay: 4 } } };
const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const store = () => ({ takeRateToken: vi.fn(async () => ({ allowed: true, retry_after_sec: 0 })) });

describe('createAgentLimiters', () => {
  it('shares counts through the database, per endpoint, when the server role is configured', async () => {
    const s = store();
    const limiters = createAgentLimiters({ config, store: s, shared: true, logger });
    await limiters.forEndpoint('capture').minuteLimiter.check('user-1');
    await limiters.forEndpoint('reply').dayLimiter.check('user-1');
    await limiters.global.check('all');
    expect(s.takeRateToken.mock.calls).toEqual([
      ['agent-capture-min', 'user-1', 2, 60],
      ['agent-reply-day', 'user-1', 3, 86_400],
      ['agent-global-day', 'all', 4, 86_400],
    ]);
  });

  it('uses per-instance limits, and never touches the database, when not configured', async () => {
    const s = store();
    const limiters = createAgentLimiters({ config, store: s, shared: false, logger });
    const { minuteLimiter } = limiters.forEndpoint('capture');
    expect((await minuteLimiter.check('u')).allowed).toBe(true);
    expect((await minuteLimiter.check('u')).allowed).toBe(true);
    expect((await minuteLimiter.check('u')).allowed).toBe(false);
    expect(s.takeRateToken).not.toHaveBeenCalled();
  });

  it('keeps the endpoints’ counts apart and gives them one shared global cap', async () => {
    const limiters = createAgentLimiters({ config, store: store(), shared: false, logger });
    const capture = limiters.forEndpoint('capture').minuteLimiter;
    const reply = limiters.forEndpoint('reply').minuteLimiter;
    await capture.check('u'); await capture.check('u');
    expect((await capture.check('u')).allowed).toBe(false);
    expect((await reply.check('u')).allowed).toBe(true);
    expect(limiters.global).toBe(limiters.global);
    for (let i = 0; i < 4; i += 1) await limiters.global.check('all');
    expect((await limiters.global.check('all')).allowed).toBe(false);
  });
});

describe('createLimiterSet', () => {
  it('names the buckets after the endpoint family, so families never share counts', async () => {
    const s = store();
    const set = createLimiterSet({ rate: { perMinute: 5, perDay: 6, globalPerDay: 7 }, prefix: 'claude', store: s, shared: true, logger });
    await set.forEndpoint('proxy').minuteLimiter.check('u');
    await set.global.check('all');
    expect(s.takeRateToken.mock.calls).toEqual([['claude-proxy-min', 'u', 5, 60], ['claude-global-day', 'all', 7, 86_400]]);
  });

  it('makes one-off limiters in the same family, shared when the database is available', async () => {
    const s = store();
    const set = createLimiterSet({ rate: { perMinute: 1, perDay: 1, globalPerDay: 1 }, prefix: 'agent', store: s, shared: true, logger });
    await set.single('stranger-hour', 5, 3_600_000).check('555');
    expect(s.takeRateToken.mock.calls).toEqual([['agent-stranger-hour', '555', 5, 3600]]);
    const local = createLimiterSet({ rate: { perMinute: 1, perDay: 1, globalPerDay: 1 }, prefix: 'agent', store: s, shared: false, logger }).single('x', 1, 60_000);
    expect((await local.check('a')).allowed).toBe(true);
    expect((await local.check('a')).allowed).toBe(false);
  });
});
