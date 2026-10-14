// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { captchaConfig, captchaScriptUrl, loadCaptchaScript, withCaptchaToken } from './captcha.js';

afterEach(() => { document.head.innerHTML = ''; });

describe('captchaConfig', () => {
  it('is off unless both a known provider and a plausible site key are given', () => {
    expect(captchaConfig({})).toBeNull();
    expect(captchaConfig({ VITE_CAPTCHA_PROVIDER: 'turnstile' })).toBeNull();
    expect(captchaConfig({ VITE_CAPTCHA_SITE_KEY: '0x4AAAAAAAbcdefgh' })).toBeNull();
  });

  it.each([['turnstile', '0x4AAAAAAAbcdefghijkl'], ['hcaptcha', '10000000-ffff-ffff-ffff-000000000001']])('accepts %s with its site key', (provider, siteKey) => {
    expect(captchaConfig({ VITE_CAPTCHA_PROVIDER: provider, VITE_CAPTCHA_SITE_KEY: siteKey })).toEqual({ provider, siteKey });
  });

  it('tolerates case and spaces in the provider name', () => {
    expect(captchaConfig({ VITE_CAPTCHA_PROVIDER: ' Turnstile ', VITE_CAPTCHA_SITE_KEY: '0x4AAAAAAAbcdefgh' })).toEqual({ provider: 'turnstile', siteKey: '0x4AAAAAAAbcdefgh' });
  });

  it.each([
    ['an unknown provider', 'recaptcha', '0x4AAAAAAAbcdefgh'],
    ['a site key with spaces', 'turnstile', '0x4AAAA bcdefgh'],
    ['a site key with markup characters', 'turnstile', '"><script>alert(1)</script>'],
    ['a very short site key', 'turnstile', 'abc'],
    ['a very long site key', 'turnstile', 'a'.repeat(300)],
  ])('refuses %s', (_n, provider, siteKey) => {
    expect(captchaConfig({ VITE_CAPTCHA_PROVIDER: provider, VITE_CAPTCHA_SITE_KEY: siteKey })).toBeNull();
  });
});

describe('captchaScriptUrl', () => {
  it('points at each provider’s own https script, loaded for explicit rendering', () => {
    expect(captchaScriptUrl('turnstile')).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    expect(captchaScriptUrl('hcaptcha')).toBe('https://js.hcaptcha.com/1/api.js?render=explicit');
    expect(captchaScriptUrl('evil')).toBeNull();
  });
});

describe('loadCaptchaScript', () => {
  it('adds the provider script once, however many times it is asked for', async () => {
    const first = loadCaptchaScript('turnstile', document);
    const second = loadCaptchaScript('turnstile', document);
    const tags = document.head.querySelectorAll('script');
    expect(tags).toHaveLength(1);
    expect(tags[0].src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    expect(tags[0].async).toBe(true);
    tags[0].dispatchEvent(new Event('load'));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('rejects, and allows a retry, if the script cannot be loaded', async () => {
    const attempt = loadCaptchaScript('hcaptcha', document);
    document.head.querySelector('script').dispatchEvent(new Event('error'));
    await expect(attempt).rejects.toThrow(/captcha/i);
    expect(document.head.querySelectorAll('script')).toHaveLength(0); // the failed tag is removed
    const retry = loadCaptchaScript('hcaptcha', document);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    document.head.querySelector('script').dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBeUndefined();
  });

  it('refuses an unknown provider without touching the page', async () => {
    await expect(loadCaptchaScript('evil', document)).rejects.toThrow();
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });
});

describe('withCaptchaToken', () => {
  it('adds the token to the options Supabase reads, keeping what was there', () => {
    expect(withCaptchaToken({ data: { name: 'Ana' } }, 'tok')).toEqual({ data: { name: 'Ana' }, captchaToken: 'tok' });
    expect(withCaptchaToken(undefined, 'tok')).toEqual({ captchaToken: 'tok' });
  });

  it('adds nothing when there is no token, so a form without CAPTCHA behaves as before', () => {
    expect(withCaptchaToken({ data: { a: 1 } }, null)).toEqual({ data: { a: 1 } });
    expect(withCaptchaToken(undefined, '')).toEqual({});
  });

  it('does not change the object it was given', () => {
    const original = { data: { a: 1 } };
    withCaptchaToken(original, 'tok');
    expect(original).toEqual({ data: { a: 1 } });
  });
});
