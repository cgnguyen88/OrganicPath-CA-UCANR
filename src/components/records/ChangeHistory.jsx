import { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { summarizeRecord } from '../../domain/records/schemas.js';
import { listRevisions } from '../../lib/records.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';

/** Every change to every record on the farm, newest first. Read-only by design. */
export default function ChangeHistory({ farm }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  const [revisions, setRevisions] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    listRevisions({ farmId: farm.id }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setLoadError(true);
      else setRevisions(data ?? []);
    });
    return () => { alive = false; };
  }, [farm.id]);

  return (
    <div style={ui.page}>
      <h1 style={ui.h1}>{tt.history.title}</h1>
      <p style={{ ...ui.subtitle, marginBottom: 20 }}>{tt.history.subtitle}</p>

      {loadError && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{tt.errors.load}</div>}
      {revisions && revisions.length === 0 && <div style={{ ...ui.card, textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>{tt.history.empty}</div>}
      {revisions && revisions.length > 0 && (
        <div style={ui.card}>
          {revisions.map((rev) => (
            <div key={rev.id} className="history-row" style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <span style={{ width: 120, fontWeight: 600, color: '#0f172a' }}>{tt.changeTypes[rev.change_type] ?? rev.change_type}</span>
              <span style={{ flex: 1, color: '#334155' }}>{rev.after ? summarizeRecord(rev.after, lang) : ''}</span>
              <span style={{ color: '#94a3b8' }}>{tt.history.version(rev.version)}</span>
              <span style={{ color: '#94a3b8', width: 90, textAlign: 'right' }}>{String(rev.changed_at).slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
