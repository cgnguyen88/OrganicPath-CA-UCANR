// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './testUtils.jsx';

vi.mock('../../lib/channels.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createTelegramLinkCode: vi.fn(), listTelegramLinks: vi.fn(), unlinkTelegram: vi.fn() };
});
const channels = await import('../../lib/channels.js');
const { default: TelegramConnect } = await import('./TelegramConnect.jsx');

const CODE = 'abcdef0123456789abcdef0123456789';
const link = { id: 'i1', lang: 'en', linkedAt: '2026-10-13T10:00:00Z', confirmed: true, displayName: 'Maria (@maria)' };

const setup = (props = {}, lang = 'en') => {
  const user = userEvent.setup();
  renderWithLang(<TelegramConnect botUsername="MyFarmBot" {...props} />, lang);
  return user;
};

beforeEach(() => {
  channels.listTelegramLinks.mockResolvedValue({ data: [], error: null });
  channels.createTelegramLinkCode.mockResolvedValue({ data: { code: CODE, expiresAt: '2026-10-13T12:15:00Z' }, error: null });
  channels.unlinkTelegram.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('TelegramConnect', () => {
  it('says Telegram is not set up, and offers no button, when the bot is not configured', async () => {
    setup({ botUsername: null });
    expect(await screen.findByText('Telegram is not set up for this app yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).toBeNull();
  });

  it('shows that nothing is connected yet', async () => {
    setup();
    expect(await screen.findByText('No Telegram account is connected yet.')).toBeTruthy();
  });

  it('lists connected accounts by the name Telegram gave, so the user can recognise their own', async () => {
    channels.listTelegramLinks.mockResolvedValue({ data: [link], error: null });
    setup();
    expect(await screen.findByText(/Connected on/)).toBeTruthy();
    expect(screen.getByText('Maria (@maria)')).toBeTruthy();
    expect(screen.getByText('English')).toBeTruthy();
  });

  it('shows a link still waiting for confirmation, with a warning to disconnect it if unrecognised', async () => {
    channels.listTelegramLinks.mockResolvedValue({ data: [{ ...link, id: 'p1', confirmed: false, displayName: 'Stranger' }], error: null });
    setup();
    expect(await screen.findByText(/Waiting for you to confirm in Telegram/)).toBeTruthy();
    expect(screen.getByText('Stranger')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('falls back to a generic label when Telegram gave no name', async () => {
    channels.listTelegramLinks.mockResolvedValue({ data: [{ ...link, displayName: null }], error: null });
    setup();
    expect(await screen.findByText('Telegram account')).toBeTruthy();
  });

  it('shows a name as plain text, never as markup', async () => {
    channels.listTelegramLinks.mockResolvedValue({ data: [{ ...link, displayName: '<img src=x onerror=alert(1)>' }], error: null });
    const { container } = (() => { const r = renderWithLang(<TelegramConnect botUsername="MyFarmBot" />); return r; })();
    expect(await screen.findByText(/<img src=x/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('creates a one-time link in the user’s language and shows how to open it', async () => {
    const user = setup({}, 'es');
    await user.click(await screen.findByRole('button', { name: 'Conectar Telegram' }));
    expect(channels.createTelegramLinkCode).toHaveBeenCalledWith('es');
    const open = await screen.findByRole('link', { name: 'Abrir Telegram' });
    expect(open.getAttribute('href')).toBe(`https://t.me/MyFarmBot?start=${CODE}`);
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toMatch(/noopener/);
    expect(screen.getByText(`/start ${CODE}`)).toBeTruthy();
  });

  it('explains a refusal, such as too many links requested', async () => {
    channels.createTelegramLinkCode.mockResolvedValue({ data: null, error: { code: 'rate_limited' } });
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/too many links/);
    expect(screen.queryByRole('link', { name: 'Open Telegram' })).toBeNull();
  });

  it('blocks a second click while the link is being made', async () => {
    let finish;
    channels.createTelegramLinkCode.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    expect(screen.getByRole('button', { name: 'Creating link…' }).disabled).toBe(true);
    finish({ data: { code: CODE, expiresAt: '2026-10-13T12:15:00Z' }, error: null });
    await screen.findByRole('link', { name: 'Open Telegram' });
  });

  it('reloads the connected accounts on request and drops the link once something is connected', async () => {
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
    await screen.findByRole('link', { name: 'Open Telegram' });
    channels.listTelegramLinks.mockResolvedValue({ data: [link], error: null });
    await user.click(screen.getByRole('button', { name: 'I connected — refresh' }));
    expect(await screen.findByText(/Connected on/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Telegram' })).toBeNull();
  });

  it('disconnects an account after asking, and reloads', async () => {
    channels.listTelegramLinks.mockResolvedValueOnce({ data: [link], error: null }).mockResolvedValue({ data: [], error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(channels.unlinkTelegram).toHaveBeenCalledWith('i1');
    expect(await screen.findByText('No Telegram account is connected yet.')).toBeTruthy();
  });

  it('does nothing if the user changes their mind', async () => {
    channels.listTelegramLinks.mockResolvedValue({ data: [link], error: null });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(channels.unlinkTelegram).not.toHaveBeenCalled();
  });

  it('says so when the connected accounts cannot be loaded', async () => {
    channels.listTelegramLinks.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    setup();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load/));
  });
});
