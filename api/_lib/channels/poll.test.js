import { describe, it, expect, vi } from 'vitest';
import { pollOnce, planPolling, runPoller } from './poll.js';

const SECRET = 'poll-secret_0123456789abcdef0123456789';
const respond = (status = 200) => async (_req, res) => { res.statusCode = status; res.end('{}'); };
const fakeApi = (...batches) => ({ getUpdates: vi.fn(async () => { const next = batches.shift(); if (next instanceof Error) throw next; return next ?? []; }) });

describe('pollOnce', () => {
  it('hands each message to the webhook handler exactly as Telegram would, then moves past it', async () => {
    const calls = [];
    const handler = async (req, res) => { calls.push(req); res.statusCode = 200; res.end('{}'); };
    const out = await pollOnce({ api: fakeApi([{ update_id: 10, message: { text: 'a' } }, { update_id: 11, message: { text: 'b' } }]), handler, secret: SECRET, offset: 5, timeoutSeconds: 20 });
    expect(out).toEqual({ offset: 12, handled: 2 });
    expect(calls.map((c) => c.body.update_id)).toEqual([10, 11]);
    expect(calls.every((c) => c.method === 'POST' && c.headers['x-telegram-bot-api-secret-token'] === SECRET)).toBe(true);
  });

  it('asks for messages from the current offset', async () => {
    const api = fakeApi([]);
    await pollOnce({ api, handler: respond(), secret: SECRET, offset: 42, timeoutSeconds: 25 });
    expect(api.getUpdates).toHaveBeenCalledWith({ offset: 42, timeoutSeconds: 25 });
  });

  it('keeps the offset when nothing arrived', async () => {
    expect(await pollOnce({ api: fakeApi([]), handler: respond(), secret: SECRET, offset: 9, timeoutSeconds: 1 })).toEqual({ offset: 9, handled: 0 });
  });

  it('stops at a message the handler could not take (a 5xx) and does NOT move past it, so it is retried', async () => {
    const handled = [];
    const handler = async (req, res) => { handled.push(req.body.update_id); res.statusCode = req.body.update_id === 11 ? 500 : 200; res.end('{}'); };
    await expect(pollOnce({ api: fakeApi([{ update_id: 10 }, { update_id: 11 }, { update_id: 12 }]), handler, secret: SECRET, offset: 0, timeoutSeconds: 1 }))
      .rejects.toMatchObject({ resumeOffset: 11 });
    expect(handled).toEqual([10, 11]); // 12 was never tried
  });

  it('moves past a message the handler refused for good (a 4xx), so it cannot block the queue', async () => {
    const out = await pollOnce({ api: fakeApi([{ update_id: 20 }]), handler: respond(401), secret: SECRET, offset: 0, timeoutSeconds: 1 });
    expect(out.offset).toBe(21);
  });

  it('skips entries that are not updates', async () => {
    const out = await pollOnce({ api: fakeApi([{ nope: true }, null, { update_id: 'x' }, { update_id: 30 }]), handler: respond(), secret: SECRET, offset: 0, timeoutSeconds: 1 });
    expect(out).toEqual({ offset: 31, handled: 1 });
  });

  it('does not let one handler crash end polling: it is retried like any failure', async () => {
    const handler = async () => { throw new Error('boom'); };
    await expect(pollOnce({ api: fakeApi([{ update_id: 40 }]), handler, secret: SECRET, offset: 0, timeoutSeconds: 1 })).rejects.toMatchObject({ resumeOffset: 40 });
  });
});

describe('planPolling', () => {
  const env = { TELEGRAM_BOT_TOKEN: '1:abcdefghij', TELEGRAM_WEBHOOK_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'k' };

  it('is fine to start when nothing else is receiving the bot’s messages', () => {
    expect(planPolling({ env, webhook: { url: '' }, flags: {} })).toEqual({ ok: true, removeWebhook: false });
  });

  it('refuses when a webhook is registered, because polling would cut off the live bot, unless told to replace it', () => {
    const plan = planPolling({ env, webhook: { url: 'https://farm.example.com/api/agent/telegram' }, flags: {} });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/farm\.example\.com/);
    expect(plan.error).toMatch(/--replace-webhook/);
    expect(planPolling({ env, webhook: { url: 'https://farm.example.com/x' }, flags: { replaceWebhook: true } })).toEqual({ ok: true, removeWebhook: true });
  });

  it.each([
    ['no bot token', { ...env, TELEGRAM_BOT_TOKEN: undefined }, /TELEGRAM_BOT_TOKEN/],
    ['no webhook secret', { ...env, TELEGRAM_WEBHOOK_SECRET: undefined }, /TELEGRAM_WEBHOOK_SECRET/],
    ['no service-role key', { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, /SUPABASE_SERVICE_ROLE_KEY/],
  ])('refuses without %s', (_n, e, message) => {
    const plan = planPolling({ env: e, webhook: { url: '' }, flags: {} });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(message);
  });
});

describe('runPoller', () => {
  it('keeps polling, carrying the offset forward, until it is stopped', async () => {
    const controller = new AbortController();
    const seen = [];
    const api = { getUpdates: vi.fn(async ({ offset }) => { seen.push(offset); if (seen.length === 3) controller.abort(); return seen.length === 1 ? [{ update_id: 5 }] : []; }) };
    await runPoller({ api, handler: respond(), secret: SECRET, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, signal: controller.signal, sleep: async () => {} });
    expect(seen).toEqual([0, 6, 6]);
  });

  it('says when it handled messages, with a count and never their content', async () => {
    const controller = new AbortController();
    let calls = 0;
    const api = { getUpdates: vi.fn(async () => { calls += 1; if (calls === 2) controller.abort(); return calls === 1 ? [{ update_id: 1, message: { text: 'my private farm note' } }, { update_id: 2, message: { text: 'another' } }] : []; }) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await runPoller({ api, handler: respond(), secret: SECRET, logger, signal: controller.signal, sleep: async () => {} });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toMatch(/handled 2 message/);
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/private farm note|another/);
  });

  it('stays quiet when nothing arrived', async () => {
    const controller = new AbortController();
    let calls = 0;
    const api = { getUpdates: vi.fn(async () => { calls += 1; if (calls === 3) controller.abort(); return []; }) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await runPoller({ api, handler: respond(), secret: SECRET, logger, signal: controller.signal, sleep: async () => {} });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('backs off and retries after an error instead of stopping, and resumes at the failed message', async () => {
    const controller = new AbortController();
    const sleeps = [];
    let calls = 0;
    const api = { getUpdates: vi.fn(async () => { calls += 1; if (calls === 1) throw new Error('connect ECONNREFUSED secret-host.internal'); if (calls === 3) controller.abort(); return calls === 2 ? [{ update_id: 7 }] : []; }) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await runPoller({ api, handler: respond(), secret: SECRET, logger, signal: controller.signal, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-host');
  });

  it('waits longer after repeated failures, up to a limit', async () => {
    const controller = new AbortController();
    const sleeps = [];
    let calls = 0;
    const api = { getUpdates: vi.fn(async () => { calls += 1; if (calls >= 8) controller.abort(); throw new Error('down'); }) };
    await runPoller({ api, handler: respond(), secret: SECRET, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, signal: controller.signal, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(30_000);
  });
});
