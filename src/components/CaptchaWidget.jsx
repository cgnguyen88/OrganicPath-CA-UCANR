import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCaptchaScript } from '../lib/captcha.js';

const TEXT = {
  en: { failed: 'The verification could not load. Turn off any content blocker for this page and try again.', retry: 'Try again' },
  es: { failed: 'No se pudo cargar la verificación. Desactiva cualquier bloqueador de contenido en esta página e inténtalo de nuevo.', retry: 'Intentar de nuevo' },
};

/**
 * The CAPTCHA challenge for the sign-in forms (Cloudflare Turnstile or hCaptcha: their widgets share
 * the same render/reset/remove calls). Renders nothing when no CAPTCHA is configured.
 *
 * `onToken(token)` fires when the person passes; `onExpire()` when the token goes stale or the check
 * fails. A token works once, so change `resetKey` after every attempt to get a fresh challenge.
 */
export default function CaptchaWidget({ config, lang = 'en', resetKey = 0, onToken, onExpire, onError }) {
  const text = TEXT[lang === 'es' ? 'es' : 'en'];
  const container = useRef(null);
  const widgetId = useRef(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Keep the latest callbacks without re-rendering the challenge when the parent re-renders.
  const handlers = useRef({ onToken, onExpire, onError });
  useEffect(() => { handlers.current = { onToken, onExpire, onError }; });

  const provider = config?.provider;
  const siteKey = config?.siteKey;

  useEffect(() => {
    if (!provider) return undefined;
    let cancelled = false;
    let rendered = null;

    loadCaptchaScript(provider)
      .then(() => {
        const api = window[provider];
        if (cancelled || !container.current || !api) return;
        setFailed(false);
        rendered = api.render(container.current, {
          sitekey: siteKey,
          ...(provider === 'hcaptcha' ? { hl: lang } : { language: lang }),
          callback: (token) => handlers.current.onToken?.(token),
          'expired-callback': () => handlers.current.onExpire?.(),
          'error-callback': () => handlers.current.onExpire?.(),
        });
        widgetId.current = rendered;
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        handlers.current.onError?.();
      });

    return () => {
      cancelled = true;
      if (rendered !== null) window[provider]?.remove?.(rendered);
      widgetId.current = null;
    };
  }, [provider, siteKey, lang, attempt]);

  // A fresh challenge after each attempt: a token can only be used once.
  const firstReset = useRef(resetKey);
  useEffect(() => {
    if (resetKey === firstReset.current || widgetId.current === null) return;
    window[provider]?.reset?.(widgetId.current);
  }, [resetKey, provider]);

  const retry = useCallback(() => { setFailed(false); setAttempt((n) => n + 1); }, []);

  if (!config) return null;
  return (
    <div style={{ margin: '4px 0 14px' }}>
      <div ref={container} />
      {failed && (
        <div role="alert" style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', borderRadius: 8, padding: '8px 12px' }}>
          {text.failed}{' '}
          <button type="button" onClick={retry} style={{ border: 'none', background: 'none', color: '#b91c1c', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>{text.retry}</button>
        </div>
      )}
    </div>
  );
}
