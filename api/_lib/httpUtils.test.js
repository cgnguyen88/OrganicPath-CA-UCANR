import { describe, it, expect, vi } from 'vitest';
import { guardRequest, redact } from './httpUtils.js';
import { makeReq, makeRes } from './testHttp.js';

const allow = () => ({ check: vi.fn(() => ({ allowed: true, remaining: 1, retryAfterSec: 0 })) });
const block = (sec = 30) => ({ check: vi.fn(() => ({ allowed: false, remaining: 0, retryAfterSec: sec })) });
const guard = (overrides = {}) => {
  const res = makeRes();
  const deps = { allowedOrigins: [], verifyToken: async () => ({ id: 'u1' }), minuteLimiter: allow(), dayLimiter: allow(), logger: { error: vi.fn() }, tag: 't', ...overrides };
  return guardRequest(makeReq({ body: {} }), res, deps).then((session) => ({ session, res, deps }));
};

describe('guardRequest rate limits', () => {
  it('accepts limiters that answer asynchronously (a database-backed limiter)', async () => {
    const asyncAllow = { check: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })) };
    const { session } = await guard({ minuteLimiter: asyncAllow, dayLimiter: asyncAllow });
    expect(session).toMatchObject({ user: { id: 'u1' } });
    const asyncBlock = { check: vi.fn(async () => ({ allowed: false, retryAfterSec: 9 })) };
    const blocked = await guard({ minuteLimiter: asyncBlock });
    expect(blocked.session).toBeNull();
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.res.getHeader('retry-after')).toBe('9');
  });

  it('spends the daily quota only when the minute limit let the request through', async () => {
    const { deps } = await guard({ minuteLimiter: block(5) });
    expect(deps.dayLimiter.check).not.toHaveBeenCalled();
  });

  it('applies the global cap after the per-user limits, answering 503 with a retry delay', async () => {
    const globalLimiter = block(120);
    const { session, res, deps } = await guard({ globalLimiter });
    expect(session).toBeNull();
    expect(res.statusCode).toBe(503);
    expect(res.getHeader('retry-after')).toBe('120');
    expect(res.json.error).toMatch(/busy/i);
    expect(deps.dayLimiter.check).toHaveBeenCalled();
    expect(globalLimiter.check).toHaveBeenCalledWith('all');
  });

  it('does not spend the global cap on a request the user limits already refused', async () => {
    const globalLimiter = allow();
    await guard({ dayLimiter: block(60), globalLimiter });
    await guard({ minuteLimiter: block(5), globalLimiter });
    expect(globalLimiter.check).not.toHaveBeenCalled();
  });

  it('lets the request through when under every limit', async () => {
    const { session } = await guard({ globalLimiter: allow() });
    expect(session).toMatchObject({ user: { id: 'u1' }, token: 'good-token' });
  });

  it('is unchanged when no global cap is configured', async () => {
    const { session } = await guard();
    expect(session).not.toBeNull();
  });
});

describe('redact', () => {
  it.each([
    ['an Anthropic key', 'failed for sk-ant-api03-AbC_123-xyz'],
    ['a Telegram bot token', 'GET /bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getFile failed'],
    ['a JWT (service-role or session)', 'bad key eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcDEF123_-xyz'],
  ])('removes %s', (_n, text) => {
    const out = redact(text);
    expect(out).not.toMatch(/sk-ant-|AAHdqTcv|eyJhbGci|eyJyb2xl/);
    expect(out).toContain('[redacted]');
  });

  it('flattens newlines so upstream text cannot forge log lines, and bounds the length', () => {
    expect(redact('a\nFAKE LOG LINE\r\tb')).not.toMatch(/[\r\n\t]/);
    expect(redact('x'.repeat(1000)).length).toBeLessThanOrEqual(200);
  });

  it('leaves ordinary messages alone', () => {
    expect(redact('permission denied for table records')).toBe('permission denied for table records');
  });
});
