import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('./supabase.js', () => ({ supabase: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) } }));
const { createTelegramLinkCode, listTelegramLinks, unlinkTelegram, telegramDeepLink, telegramBotUsername } = await import('./channels.js');

beforeEach(() => { rpc.mockReset(); from.mockReset(); });

describe('createTelegramLinkCode', () => {
  it('asks the database for a code in the user’s language and returns it with its expiry', async () => {
    rpc.mockResolvedValue({ data: [{ code: 'a'.repeat(32), expires_at: '2026-10-13T12:15:00Z' }], error: null });
    expect(await createTelegramLinkCode('es')).toEqual({ data: { code: 'a'.repeat(32), expiresAt: '2026-10-13T12:15:00Z' }, error: null });
    expect(rpc).toHaveBeenCalledWith('create_channel_link_code', { p_lang: 'es' });
  });

  it('sends English for anything that is not Spanish', async () => {
    rpc.mockResolvedValue({ data: [{ code: 'b'.repeat(32), expires_at: 'x' }], error: null });
    await createTelegramLinkCode('fr');
    expect(rpc).toHaveBeenCalledWith('create_channel_link_code', { p_lang: 'en' });
  });

  it.each([
    [{ code: '42501', message: 'You are not part of a farm yet' }, 'no_farm'],
    [{ code: '54000', message: 'Too many codes requested' }, 'rate_limited'],
    [{ code: '28000', message: 'Sign in first' }, 'signin'],
    [{ code: 'XX000', message: 'boom' }, 'unknown'],
  ])('explains %j as %s', async (error, code) => {
    rpc.mockResolvedValue({ data: null, error });
    expect(await createTelegramLinkCode('en')).toEqual({ data: null, error: { code } });
  });

  it('treats an answer without a code as a failure', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await createTelegramLinkCode('en')).error.code).toBe('unknown');
  });
});

describe('listTelegramLinks and unlinkTelegram', () => {
  it('lists the user’s own Telegram links, newest first', async () => {
    const order = vi.fn(async () => ({ data: [{ id: 'i1', lang: 'en', linked_at: '2026-10-13T10:00:00Z', confirmed_at: '2026-10-13T10:01:00Z', display_name: 'Maria (@maria)' }], error: null }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });
    expect(await listTelegramLinks()).toEqual({ data: [{ id: 'i1', lang: 'en', linkedAt: '2026-10-13T10:00:00Z', confirmed: true, displayName: 'Maria (@maria)' }], error: null });
    expect(from).toHaveBeenCalledWith('channel_identities');
    expect(select).toHaveBeenCalledWith('id, lang, linked_at, confirmed_at, display_name');
    expect(eq).toHaveBeenCalledWith('provider', 'telegram');
    expect(order).toHaveBeenCalledWith('linked_at', { ascending: false });
  });

  it('marks a link that is still waiting for the Telegram user to confirm', async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'i2', lang: 'es', linked_at: 'x', confirmed_at: null, display_name: null }], error: null }) }) }) });
    expect((await listTelegramLinks()).data[0]).toMatchObject({ confirmed: false, displayName: null });
  });

  it('never asks for or exposes the Telegram account id', async () => {
    const select = vi.fn(() => ({ eq: () => ({ order: async () => ({ data: [{ id: 'i1', external_id: '555', lang: 'en', linked_at: 'x', confirmed_at: 'y', display_name: 'Maria' }], error: null }) }) }));
    from.mockReturnValue({ select });
    expect(select.mock.calls.length === 0 || true).toBe(true);
    await listTelegramLinks();
    expect(select.mock.calls[0][0]).not.toMatch(/external_id/);
    expect(JSON.stringify(await listTelegramLinks())).not.toContain('555');
  });

  it('reports a failure to load', async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: 'x' } }) }) }) });
    expect(await listTelegramLinks()).toEqual({ data: null, error: { code: 'unknown' } });
  });

  it('unlinks by id', async () => {
    const eq = vi.fn(async () => ({ error: null }));
    from.mockReturnValue({ delete: () => ({ eq }) });
    expect(await unlinkTelegram('i1')).toEqual({ error: null });
    expect(eq).toHaveBeenCalledWith('id', 'i1');
    from.mockReturnValue({ delete: () => ({ eq: async () => ({ error: { message: 'x' } }) }) });
    expect(await unlinkTelegram('i1')).toEqual({ error: { code: 'unknown' } });
  });
});

describe('telegramDeepLink and telegramBotUsername', () => {
  it('builds the link that opens the bot and passes the code to /start', () => {
    expect(telegramDeepLink('MyFarmBot', 'a'.repeat(32))).toBe(`https://t.me/MyFarmBot?start=${'a'.repeat(32)}`);
  });

  it.each([['', 'a'.repeat(32)], ['bad name!', 'a'.repeat(32)], ['MyFarmBot', 'not a code'], ['MyFarmBot', 'a'.repeat(33)], ['MyFarmBot', '']])('refuses to build a link from %j / %j', (name, code) => {
    expect(telegramDeepLink(name, code)).toBeNull();
  });

  it('accepts only a plausible bot username from the environment', () => {
    expect(telegramBotUsername({ VITE_TELEGRAM_BOT_USERNAME: '@MyFarmBot' })).toBe('MyFarmBot');
    expect(telegramBotUsername({ VITE_TELEGRAM_BOT_USERNAME: 'MyFarmBot' })).toBe('MyFarmBot');
    for (const bad of [undefined, '', 'ab', 'has space', 'x'.repeat(40), 'evil/../x', 'a?b=c']) expect(telegramBotUsername({ VITE_TELEGRAM_BOT_USERNAME: bad })).toBeNull();
  });
});
