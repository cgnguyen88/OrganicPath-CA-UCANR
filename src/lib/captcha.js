/**
 * CAPTCHA for the sign-in and sign-up forms. Supabase can require a CAPTCHA token on every sign-in
 * and sign-up (Authentication → Attack Protection). The token comes from a provider widget; Supabase
 * checks it with the provider's secret key, which only Supabase holds. The site key used here is
 * public by design.
 *
 * Configured with two build-time settings; with either missing the form behaves exactly as before:
 *   VITE_CAPTCHA_PROVIDER = turnstile | hcaptcha
 *   VITE_CAPTCHA_SITE_KEY = the provider's public site key
 */

const SCRIPTS = Object.freeze({
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
});
const SITE_KEY = /^[A-Za-z0-9_.-]{8,100}$/;

// Only these two settings are read, by name. Referring to the whole build environment object makes Vite copy
// every VITE_ variable into the browser bundle, including any secret stored under that prefix by mistake.
const BUILD_SETTINGS = Object.freeze({
  VITE_CAPTCHA_PROVIDER: import.meta.env.VITE_CAPTCHA_PROVIDER,
  VITE_CAPTCHA_SITE_KEY: import.meta.env.VITE_CAPTCHA_SITE_KEY,
});

/** @returns {{ provider: 'turnstile' | 'hcaptcha', siteKey: string } | null} */
export function captchaConfig(env = BUILD_SETTINGS) {
  const provider = String(env?.VITE_CAPTCHA_PROVIDER ?? '').trim().toLowerCase();
  const siteKey = String(env?.VITE_CAPTCHA_SITE_KEY ?? '').trim();
  return Object.hasOwn(SCRIPTS, provider) && SITE_KEY.test(siteKey) ? { provider, siteKey } : null;
}

/** The provider's own script URL, or null for an unknown provider. */
export const captchaScriptUrl = (provider) => (Object.hasOwn(SCRIPTS, provider) ? SCRIPTS[provider] : null);

const pending = new Map(); // provider -> promise of the script being loaded

/**
 * Load the provider's script once. Resolves when it is ready; rejects (and forgets the failed tag so
 * a retry works) if it cannot be loaded, for example when an ad blocker stops it.
 */
export function loadCaptchaScript(provider, doc = document) {
  const src = captchaScriptUrl(provider);
  if (!src) return Promise.reject(new Error('Unknown captcha provider.'));
  if (pending.has(`${provider}`) && doc.head.querySelector(`script[src="${src}"]`)) return pending.get(provider);

  const promise = new Promise((resolve, reject) => {
    const tag = doc.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.defer = true;
    tag.addEventListener('load', () => resolve());
    tag.addEventListener('error', () => {
      tag.remove();
      pending.delete(provider);
      reject(new Error('The captcha could not be loaded.'));
    });
    doc.head.appendChild(tag);
  });
  pending.set(provider, promise);
  return promise;
}

/** Options for a Supabase auth call, with the CAPTCHA token added when there is one. */
export function withCaptchaToken(options, token) {
  return token ? { ...options, captchaToken: token } : { ...options };
}
