import { useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { checkMaterial } from '../../lib/agent.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';

const VERDICT_TONE = { listed_allowed: 'success', prohibited: 'danger', not_named: 'warning', needs_review: 'neutral' };
const alertStyle = { padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, marginTop: 12 };

function Result({ outcome, lang }) {
  const tt = recordsText(lang).material;
  const { verdict, summary, caveats = [], sources = [] } = outcome.result;
  const tone = ui.TONES[VERDICT_TONE[verdict]] ?? ui.TONES.neutral;

  return (
    <div style={{ marginTop: 14 }}>
      <span style={{ ...tone, padding: '3px 11px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>{tt.verdicts[verdict] ?? tt.verdicts.needs_review}</span>
      {summary && <p style={{ margin: '10px 0 0', fontSize: 14, color: '#0f172a', whiteSpace: 'pre-line' }}>{summary}</p>}
      {verdict === 'not_named' && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#92400e' }}>{tt.notNamedNote}</p>}
      {verdict === 'needs_review' && !summary && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#475569' }}>{tt.unconfirmed}</p>}

      {caveats.length > 0 && (
        <>
          <h3 style={{ fontSize: 12, color: '#475569', margin: '14px 0 4px' }}>{tt.caveats}</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#334155' }}>
            {caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}
          </ul>
        </>
      )}

      {sources.length > 0 && (
        <>
          <h3 style={{ fontSize: 12, color: '#475569', margin: '14px 0 4px' }}>{tt.sources}</h3>
          {sources.map((source) => (
            <div key={source.citation} style={{ ...ui.card, padding: '10px 12px', marginBottom: 8, background: '#f8fafc' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--u-navy)' }}>{source.citation}</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{tt.asOf(source.version_date)}</span>
                <a href={source.source_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', fontSize: 12 }}>{tt.viewOnEcfr}</a>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 4px' }}>{source.heading}</div>
              <div style={{ fontSize: 12, color: '#334155' }}>{source.excerpt}</div>
            </div>
          ))}
        </>
      )}

      <p style={{ margin: '12px 0 0', fontSize: 12, color: '#64748b' }}>{tt.reminder}</p>
    </div>
  );
}

/** "Is this material allowed?" against 7 CFR 205, with the cited regulation text shown. */
export default function MaterialCheck() {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  const [material, setMaterial] = useState('');
  const [use, setUse] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState(null);
  const [outcome, setOutcome] = useState(null);

  const canSubmit = !busy && material.trim() !== '';

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErrorCode(null);
    const { data, error } = await checkMaterial({ material: material.trim(), use: use.trim(), lang });
    setBusy(false);
    if (error) {
      setErrorCode(error.code);
      return;
    }
    setOutcome(data);
  }

  return (
    <section style={{ ...ui.card, padding: '18px 20px', marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, color: 'var(--u-navy)', margin: '0 0 4px' }}>{tt.material.title}</h2>
      <p style={{ ...ui.subtitle, margin: '0 0 14px', fontSize: 13 }}>{tt.material.subtitle}</p>

      <form onSubmit={submit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="material-name" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{tt.material.materialLabel}</label>
          <input id="material-name" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder={tt.material.materialPlaceholder} maxLength={120} style={ui.input} />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="material-use" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{tt.material.useLabel}</label>
          <input id="material-use" value={use} onChange={(e) => setUse(e.target.value)} placeholder={tt.material.usePlaceholder} maxLength={200} style={ui.input} />
        </div>
        <button type="submit" disabled={!canSubmit} style={{ ...ui.buttonPrimary, ...(canSubmit ? {} : ui.buttonDisabled) }}>
          {busy ? tt.material.checking : tt.material.check}
        </button>
      </form>

      {errorCode && <div role="alert" style={alertStyle}>{tt.capture.errors[errorCode] ?? tt.errors.unknown}</div>}
      {outcome && !busy && <Result outcome={outcome} lang={lang} />}
    </section>
  );
}
