import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { createTelegramLinkCode, listTelegramLinks, telegramBotUsername, telegramDeepLink, unlinkTelegram } from '../../lib/channels.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';

const alertStyle = { padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, marginTop: 12 };

/**
 * Connect a Telegram account to the farm: make a one-time link, open it in Telegram, and see (and
 * disconnect) the accounts already connected. Only connected accounts can use the bot.
 *
 * `botUsername` defaults to the one in the build environment (VITE_TELEGRAM_BOT_USERNAME).
 */
export default function TelegramConnect({ botUsername = telegramBotUsername() }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang).telegram;

  const [links, setLinks] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(null); // { code, expiresAt } while a link is on screen
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await listTelegramLinks();
    setLoadFailed(Boolean(error));
    if (data) {
      setLinks(data);
      return data;
    }
    return null;
  }, []);

  useEffect(() => {
    let alive = true;
    listTelegramLinks().then(({ data, error }) => {
      if (!alive) return;
      setLoadFailed(Boolean(error));
      if (data) setLinks(data);
    });
    return () => { alive = false; };
  }, []);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const { data, error } = await createTelegramLinkCode(lang);
    setBusy(false);
    if (error) {
      setErrorCode(error.code);
      return;
    }
    setPending(data);
  }

  async function refresh() {
    const before = links?.length ?? 0;
    const after = await load();
    if (after && after.length > before) setPending(null);
  }

  async function disconnect(id) {
    if (!window.confirm(tt.unlinkConfirm)) return;
    const { error } = await unlinkTelegram(id);
    setErrorCode(error ? error.code : null);
    await load();
  }

  const deepLink = pending && botUsername ? telegramDeepLink(botUsername, pending.code) : null;
  const expiry = pending ? new Date(pending.expiresAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <section style={{ ...ui.card, padding: '18px 20px', marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, color: 'var(--u-navy)', margin: '0 0 4px' }}>{tt.title}</h2>
      <p style={{ ...ui.subtitle, margin: '0 0 14px', fontSize: 13 }}>{tt.subtitle}</p>

      {!botUsername ? (
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>{tt.notConfigured}</p>
      ) : (
        <>
          <button type="button" onClick={connect} disabled={busy} style={{ ...ui.buttonPrimary, ...(busy ? ui.buttonDisabled : {}) }}>
            {busy ? tt.connecting : tt.connect}
          </button>

          {deepLink && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 13, color: '#334155', margin: '0 0 10px' }}>{tt.linkIntro}</p>
              <a href={deepLink} target="_blank" rel="noopener noreferrer" style={{ ...ui.buttonSuccess, textDecoration: 'none' }}>{tt.openTelegram}</a>
              <p style={{ fontSize: 12, color: '#64748b', margin: '12px 0 4px' }}>{tt.orSend}</p>
              <code style={{ display: 'block', fontSize: 12, background: '#f1f5f9', borderRadius: 6, padding: '6px 10px', wordBreak: 'break-all' }}>{`/start ${pending.code}`}</code>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0 10px' }}>{tt.expiresAt(expiry)}</p>
              <button type="button" onClick={refresh} style={ui.buttonSecondary}>{tt.refresh}</button>
            </div>
          )}
        </>
      )}

      {errorCode && <div role="alert" style={alertStyle}>{tt.errors[errorCode] ?? tt.errors.unknown}</div>}
      {loadFailed && <div role="alert" style={alertStyle}>{tt.errors.load}</div>}

      {links && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 13, color: '#475569', margin: '0 0 8px' }}>{tt.connectedTitle}</h3>
          {links.length === 0 ? (
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{tt.none}</p>
          ) : (
            links.map((item) => (
              <div key={item.id} style={{ padding: '8px 0', borderTop: '1px solid #f1f5f9', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <strong>{item.displayName ?? tt.unnamed}</strong>
                  <span>{tt.connectedOn(new Date(item.linkedAt).toLocaleDateString(lang))}</span>
                  <span style={{ color: '#64748b' }}>{tt.language[item.lang] ?? item.lang}</span>
                  <button type="button" onClick={() => disconnect(item.id)} style={{ ...ui.buttonDanger, marginLeft: 'auto', padding: '4px 12px' }}>{tt.unlink}</button>
                </div>
                {!item.confirmed && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#92400e' }}>{tt.pending}</p>}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
