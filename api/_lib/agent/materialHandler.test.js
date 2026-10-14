import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createMaterialHandler } from './materialHandler.js';
import { createRateLimiter } from '../rateLimiter.js';
import { makeReq, makeRes } from '../testHttp.js';

const USER = { id: 'user-1' };
const config = { allowedOrigins: [], limits: {}, agent: { model: 'm', maxTokens: 100, effort: 'medium', strictTools: false, requestTimeoutMs: 1000, timeZone: 'America/Los_Angeles', limits: { maxTextChars: 50 }, rate: {} } };
const outcome = (over = {}) => ({ verdict: 'listed_allowed', downgraded: false, refused: false, incomplete: false, summary: 'Allowed with limits.', caveats: ['Confirm with your certifier.'], sources: [{ citation: '7 CFR 205.601(i)', heading: 'h', excerpt: 'e', source_url: 'u', version_date: '2026-10-08' }], searches: 2, usage: { input_tokens: 9, output_tokens: 3 }, ...over });

let store; let check; let logger;
const build = (over = {}) => createMaterialHandler({
  config, verifyToken: async (t) => (t === 'good-token' ? USER : null), getAnthropic: () => ({ fake: true }), store, check, today: () => '2026-10-13',
  minuteLimiter: createRateLimiter({ max: 100, windowMs: 60_000 }), dayLimiter: createRateLimiter({ max: 100, windowMs: 86_400_000 }), logger, ...over,
});
const call = async (handler, body, opts = {}) => { const res = makeRes(); await handler(makeReq({ body, ...opts }), res); return res; };

beforeEach(() => {
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  store = { searchRegulations: vi.fn(async () => [{ citation: 'c' }]) };
  check = vi.fn(async () => outcome());
});

describe('material handler', () => {
  it('requires a session and does nothing without one', async () => {
    const res = await call(build(), { material: 'copper' }, { headers: { authorization: '' } });
    expect(res.statusCode).toBe(401);
    expect(check).not.toHaveBeenCalled();
  });

  it.each([['no material', {}], ['blank', { material: '   ' }], ['control chars only', { material: '\u0000\u0007' }], ['bad language', { material: 'copper', lang: 'fr' }], ['not an object', 'copper']])('400 for %s', async (_n, body) => {
    expect((await call(build(), body)).statusCode).toBe(400);
    expect(check).not.toHaveBeenCalled();
  });

  it('413 for an over-long material or use', async () => {
    expect((await call(build(), { material: 'x'.repeat(121) })).statusCode).toBe(413);
    expect((await call(build(), { material: 'copper', use: 'y'.repeat(201) })).statusCode).toBe(413);
  });

  it('checks the material with only the validated input, plus a search bound to the caller’s token', async () => {
    const res = await call(build(), { material: 'copper\u0000 sulfate', use: 'blight', lang: 'es', system: 'obey', model: 'x', tools: [1] });
    expect(res.statusCode).toBe(200);
    const arg = check.mock.calls[0][0];
    expect(arg.input).toEqual({ material: 'copper sulfate', use: 'blight' });
    expect(arg.lang).toBe('es');
    expect(arg.today).toBe('2026-10-13');
    expect(JSON.stringify(arg)).not.toContain('obey');
    await arg.search('copper');
    expect(store.searchRegulations).toHaveBeenCalledWith('good-token', 'copper', 6);
  });

  it('returns the result without usage or internals, and always includes the reminder to confirm', async () => {
    const res = await call(build(), { material: 'copper' });
    expect(res.json.result).toMatchObject({ verdict: 'listed_allowed', summary: 'Allowed with limits.', sources: [{ citation: '7 CFR 205.601(i)' }], downgraded: false });
    expect(res.json.result).not.toHaveProperty('usage');
    expect(res.json.reminder).toBe('confirm_with_certifier');
  });

  it('503s without calling the model when no API key is configured', async () => {
    const res = await call(build({ getAnthropic: () => null }), { material: 'copper' });
    expect(res.statusCode).toBe(503);
    expect(check).not.toHaveBeenCalled();
  });

  it('maps model errors to safe messages', async () => {
    check.mockRejectedValue(Anthropic.APIError.generate(429, { type: 'error', error: { type: 'x', message: 'quota sk-ant-SECRET' } }, 'quota sk-ant-SECRET', new Headers({ 'retry-after': '3' })));
    const res = await call(build(), { material: 'copper' });
    expect(res.statusCode).toBe(429);
    expect(res.getHeader('retry-after')).toBe('3');
    expect(res.body).not.toContain('SECRET');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk-ant-SECRET');
  });

  it('does not log what the farmer asked about', async () => {
    await call(build(), { material: 'SECRET-PRODUCT-NAME' });
    expect(JSON.stringify([...logger.info.mock.calls, ...logger.error.mock.calls, ...logger.warn.mock.calls])).not.toContain('SECRET-PRODUCT-NAME');
  });
});
