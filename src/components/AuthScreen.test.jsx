// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithLang } from './records/testUtils.jsx';

const signInWithPassword = vi.fn();
const signUp = vi.fn();
vi.mock('../lib/supabase.js', () => ({ supabase: { auth: { signInWithPassword: (...a) => signInWithPassword(...a), signUp: (...a) => signUp(...a) } } }));

let mockConfig = null;
vi.mock('../lib/captcha.js', async (importOriginal) => ({ ...(await importOriginal()), captchaConfig: () => mockConfig }));

// A stand-in for the real challenge: a button that "passes" it.
vi.mock('./CaptchaWidget.jsx', () => ({
  default: ({ config, onToken, onExpire, resetKey }) => (config ? (
    <div data-testid="captcha" data-reset-key={resetKey}>
      <button type="button" onClick={() => onToken('captcha-token-1')}>pass captcha</button>
      <button type="button" onClick={() => onExpire()}>expire captcha</button>
    </div>
  ) : null),
}));

const { default: AuthScreen } = await import('./AuthScreen.jsx');

const USER = { id: 'u1', email: 'ana@example.com', user_metadata: { name: 'Ana' } };
const setup = (lang = 'en') => {
  const onLogin = vi.fn();
  const user = userEvent.setup();
  renderWithLang(<AuthScreen onLogin={onLogin} />, lang);
  return { user, onLogin };
};
const fillSignIn = async (user, email = 'ana@example.com', password = 'secret123') => {
  await user.type(screen.getByPlaceholderText(/email|correo/i), email);
  await user.type(screen.getByPlaceholderText(/password|contraseña/i), password);
};
const submit = (user) => user.click(screen.getByRole('button', { name: /^(sign in|iniciar sesión)$/i }));

beforeEach(() => {
  mockConfig = null;
  signInWithPassword.mockResolvedValue({ data: { user: USER, session: { access_token: 't' } }, error: null });
  signUp.mockResolvedValue({ data: { user: USER, session: null }, error: null });
});
afterEach(cleanup);

describe('AuthScreen without a CAPTCHA configured', () => {
  it('signs in exactly as before and shows no challenge', async () => {
    const { user, onLogin } = setup();
    expect(screen.queryByTestId('captcha')).toBeNull();
    await fillSignIn(user);
    await submit(user);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'ana@example.com', password: 'secret123' });
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', name: 'Ana' })));
  });
});

describe('AuthScreen with a CAPTCHA configured', () => {
  beforeEach(() => { mockConfig = { provider: 'turnstile', siteKey: '0x4AAAAAAAbcdefgh' }; });

  it('shows the challenge and keeps Sign in disabled until it is passed', async () => {
    const { user } = setup();
    expect(screen.getByTestId('captcha')).toBeTruthy();
    await fillSignIn(user);
    expect(screen.getByRole('button', { name: /^sign in$/i }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    expect(screen.getByRole('button', { name: /^sign in$/i }).disabled).toBe(false);
  });

  it('sends the token to Supabase when signing in', async () => {
    const { user, onLogin } = setup();
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await submit(user);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'ana@example.com', password: 'secret123', options: { captchaToken: 'captcha-token-1' } });
    await waitFor(() => expect(onLogin).toHaveBeenCalled());
  });

  it('sends the token when creating an account too, alongside the farm details', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));
    await user.type(screen.getByPlaceholderText(/^(full )?name$|^nombre/i), 'Ana');
    await user.type(screen.getByPlaceholderText(/farm|finca/i), 'Sunny Acres');
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await user.click(screen.getByRole('button', { name: /^(sign up|create account|crear cuenta|registrarse)$/i, hidden: false }));
    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(signUp.mock.calls[0][0].options).toMatchObject({ captchaToken: 'captcha-token-1', data: { name: 'Ana', farm_name: 'Sunny Acres' } });
  });

  it('needs a fresh check after every attempt, because a token works once', async () => {
    signInWithPassword.mockResolvedValue({ data: null, error: { message: 'Invalid login credentials' } });
    const { user } = setup();
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await submit(user);
    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(screen.getByTestId('captcha').dataset.resetKey).toBe('1');
    expect(screen.getByRole('button', { name: /^sign in$/i }).disabled).toBe(true);
  });

  it('drops a token that expired before the form was sent', async () => {
    const { user } = setup();
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await user.click(screen.getByRole('button', { name: 'expire captcha' }));
    expect(screen.getByRole('button', { name: /^sign in$/i }).disabled).toBe(true);
  });

  it('never calls Supabase without a token, even if the form is submitted by other means than the button', async () => {
    const { user } = setup();
    await fillSignIn(user);
    fireEvent.submit(screen.getByPlaceholderText(/password/i).closest('form'));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(await screen.findByText(/complete the verification/i)).toBeTruthy();
  });

  it.each([
    ['en', 'captcha protection: request disallowed (no captcha_token found)', /complete the verification/i],
    ['es', 'captcha protection: request disallowed (no captcha_token found)', /completa la verificación/i],
  ])('asks them to complete the check when Supabase received no token (%s)', async (lang, rawMessage, expected) => {
    signInWithPassword.mockResolvedValue({ data: null, error: { message: rawMessage } });
    const { user } = setup(lang);
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await user.click(screen.getByRole('button', { name: /^(sign in|iniciar sesión)$/i }));
    expect((await screen.findAllByText(expected))[0].textContent).not.toMatch(/captcha_token/);
  });

  it.each([
    ['en', 'captcha protection: request disallowed (invalid-input-response)', /not accepted \(invalid-input-response\)/],
    ['en', 'captcha protection: request disallowed (sitekey-secret-mismatch)', /not accepted \(sitekey-secret-mismatch\)/],
    ['es', 'captcha protection: request disallowed (invalid-input-response)', /no fue aceptada \(invalid-input-response\)/],
  ])('says the verification was refused and shows the provider’s reason code, for the site owner (%s)', async (lang, rawMessage, expected) => {
    signInWithPassword.mockResolvedValue({ data: null, error: { message: rawMessage } });
    const { user } = setup(lang);
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await user.click(screen.getByRole('button', { name: /^(sign in|iniciar sesión)$/i }));
    expect((await screen.findAllByText(expected))[0]).toBeTruthy();
  });

  it('still explains a refusal that carries no reason code', async () => {
    signInWithPassword.mockResolvedValue({ data: null, error: { message: 'captcha verification process failed' } });
    const { user } = setup();
    await fillSignIn(user);
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect((await screen.findAllByText(/verification was not accepted\./i))[0]).toBeTruthy();
  });

  it('starts a fresh check when switching between sign in and sign up', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'pass captcha' }));
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));
    expect(screen.getByTestId('captcha').dataset.resetKey).toBe('1');
  });
});
