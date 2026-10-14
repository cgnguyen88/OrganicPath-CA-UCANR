// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../lib/captcha.js', () => ({ loadCaptchaScript: vi.fn() }));
const { loadCaptchaScript } = await import('../lib/captcha.js');
const { default: CaptchaWidget } = await import('./CaptchaWidget.jsx');

const CONFIG = { provider: 'turnstile', siteKey: '0x4AAAAAAAbcdefgh' };
let api;

beforeEach(() => {
  api = { render: vi.fn(() => 'widget-1'), reset: vi.fn(), remove: vi.fn() };
  window.turnstile = api;
  window.hcaptcha = api;
  loadCaptchaScript.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); delete window.turnstile; delete window.hcaptcha; vi.clearAllMocks(); });

const setup = (props = {}) => render(<CaptchaWidget config={CONFIG} lang="en" onToken={vi.fn()} onExpire={vi.fn()} {...props} />);

describe('CaptchaWidget', () => {
  it('loads the provider script and renders the challenge with the public site key', async () => {
    setup();
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
    expect(loadCaptchaScript).toHaveBeenCalledWith('turnstile');
    const [element, options] = api.render.mock.calls[0];
    expect(element).toBeInstanceOf(HTMLElement);
    expect(options.sitekey).toBe(CONFIG.siteKey);
  });

  it('hands the token to the form when the person passes the check', async () => {
    const onToken = vi.fn();
    setup({ onToken });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    act(() => api.render.mock.calls[0][1].callback('token-123'));
    expect(onToken).toHaveBeenCalledWith('token-123');
  });

  it('clears the token when it expires or the check errors', async () => {
    const onExpire = vi.fn();
    setup({ onExpire });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    const options = api.render.mock.calls[0][1];
    act(() => options['expired-callback']());
    act(() => options['error-callback']());
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it('uses the same call for hCaptcha, in the interface language', async () => {
    setup({ config: { provider: 'hcaptcha', siteKey: '10000000-ffff-ffff-ffff-000000000001' }, lang: 'es' });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    expect(loadCaptchaScript).toHaveBeenCalledWith('hcaptcha');
    expect(api.render.mock.calls[0][1]).toMatchObject({ sitekey: '10000000-ffff-ffff-ffff-000000000001', hl: 'es' });
  });

  it('starts a fresh challenge when asked to reset (a token can be used only once)', async () => {
    const { rerender } = setup({ resetKey: 0 });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    rerender(<CaptchaWidget config={CONFIG} lang="en" onToken={vi.fn()} onExpire={vi.fn()} resetKey={1} />);
    await waitFor(() => expect(api.reset).toHaveBeenCalledWith('widget-1'));
  });

  it('cleans up the challenge when the form goes away', async () => {
    const { unmount } = setup();
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('says so, and offers a retry, if the provider script is blocked', async () => {
    loadCaptchaScript.mockRejectedValueOnce(new Error('blocked'));
    const user = userEvent.setup();
    const onError = vi.fn();
    setup({ onError });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/i);
    expect(onError).toHaveBeenCalled();
    loadCaptchaScript.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the message in Spanish', async () => {
    loadCaptchaScript.mockRejectedValueOnce(new Error('blocked'));
    setup({ lang: 'es' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/no se pudo cargar/i);
  });

  it('does nothing when no CAPTCHA is configured', () => {
    const { container } = render(<CaptchaWidget config={null} lang="en" onToken={vi.fn()} onExpire={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    expect(loadCaptchaScript).not.toHaveBeenCalled();
  });
});
