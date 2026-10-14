import { describe, it, expect, vi } from 'vitest';
import { planWebhook, applyWebhook } from './setWebhook.js';

const GOOD = { TELEGRAM_BOT_TOKEN: '123456:abcdefghij', TELEGRAM_WEBHOOK_SECRET: 'sec_ret-1234567890123456789012345678' };

describe('planWebhook', () => {
  it('describes what would be registered, without ever including a secret', () => {
    const plan = planWebhook({ env: GOOD, url: 'https://farm.example.com/api/agent/telegram' });
    expect(plan).toEqual({ ok: true, url: 'https://farm.example.com/api/agent/telegram', summary: expect.stringContaining('https://farm.example.com/api/agent/telegram') });
    expect(JSON.stringify(plan)).not.toContain('sec_ret-1234567890123456789012345678');
    expect(JSON.stringify(plan)).not.toContain('abcdefghij');
  });

  it.each([
    ['no URL', { env: GOOD, url: undefined }, /--url/],
    ['an http URL', { env: GOOD, url: 'http://farm.example.com/api/agent/telegram' }, /https/],
    ['a URL for the wrong path', { env: GOOD, url: 'https://farm.example.com/somewhere' }, /\/api\/agent\/telegram/],
    ['a localhost URL', { env: GOOD, url: 'https://localhost/api/agent/telegram' }, /public/],
    ['no bot token', { env: { TELEGRAM_WEBHOOK_SECRET: 'sec_ret-1234567890123456789012345678' }, url: 'https://f.example.com/api/agent/telegram' }, /TELEGRAM_BOT_TOKEN/],
    ['no webhook secret', { env: { TELEGRAM_BOT_TOKEN: '1:abcdefghij' }, url: 'https://f.example.com/api/agent/telegram' }, /TELEGRAM_WEBHOOK_SECRET/],
    ['a weak webhook secret', { env: { ...GOOD, TELEGRAM_WEBHOOK_SECRET: 'sec_ret-1234567890123' }, url: 'https://f.example.com/api/agent/telegram' }, /at least 32/],
  ])('refuses %s', (_n, args, message) => {
    const plan = planWebhook(args);
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(message);
  });
});

describe('applyWebhook', () => {
  it('registers the URL with the secret and reports which bot it is', async () => {
    const api = { setWebhook: vi.fn(async () => {}), getMe: vi.fn(async () => ({ username: 'MyFarmBot' })) };
    const out = await applyWebhook({ api, url: 'https://f.example.com/api/agent/telegram', secret: 'sec_ret-123456789012' });
    expect(api.setWebhook).toHaveBeenCalledWith({ url: 'https://f.example.com/api/agent/telegram', secretToken: 'sec_ret-123456789012' });
    expect(out).toEqual({ username: 'MyFarmBot' });
  });

  it('lets a Telegram failure through so the command can report it', async () => {
    const api = { setWebhook: vi.fn(async () => { throw new Error('Telegram setWebhook failed: bad webhook'); }), getMe: vi.fn() };
    await expect(applyWebhook({ api, url: 'https://f.example.com/api/agent/telegram', secret: 'x'.repeat(20) })).rejects.toThrow(/bad webhook/);
  });
});
