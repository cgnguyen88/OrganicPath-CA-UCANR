import { useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { RECORD_KINDS, KIND_META } from '../../domain/records/kinds.js';
import { DEFAULT_SAVED_VIEWS } from '../../domain/records/savedViews.js';
import { ROUTES, logRoute, viewRoute } from '../../lib/recordsRoute.js';
import { recordsText, viewName } from './text.js';
import { KIND_ICONS } from './icons.js';
import * as ui from './ui.js';
import CapturePanel from './CapturePanel.jsx';
import MaterialCheck from './MaterialCheck.jsx';
import TelegramConnect from './TelegramConnect.jsx';
import RecordForm from './RecordForm.jsx';

/** The records home: what needs review, start a record of any kind, and the saved views. */
export default function RecordsOverview({ farm, role, savedViews, needsReviewCount, onNavigate, onChanged }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);
  const [adding, setAdding] = useState(null);

  return (
    <div style={ui.page}>
      <h1 style={ui.h1}>{tt.overview.title}</h1>
      <p style={{ ...ui.subtitle, marginBottom: 22 }}>{tt.overview.subtitle}</p>

      <CapturePanel onChanged={onChanged} onNavigate={onNavigate} />
      <MaterialCheck />
      <TelegramConnect />

      {needsReviewCount > 0 && (
        <div style={{ ...ui.card, borderColor: '#fde68a', background: '#fffbeb', padding: '14px 18px', marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: '#92400e', fontWeight: 600 }}>{tt.overview.needsReview(needsReviewCount)}</span>
          <button type="button" onClick={() => onNavigate(ROUTES.review)} style={ui.buttonPrimary}>{tt.overview.openReview}</button>
        </div>
      )}

      <h2 style={{ fontSize: 14, color: '#475569', margin: '0 0 10px' }}>{tt.overview.addTitle}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 26 }}>
        {RECORD_KINDS.map((kind) => {
          const Icon = KIND_ICONS[KIND_META[kind].icon];
          return (
            <button key={kind} type="button" onClick={() => setAdding(kind)} style={{ ...ui.card, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#0f172a', textAlign: 'left' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: `${KIND_META[kind].color}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={15} color={KIND_META[kind].color} />
              </span>
              {KIND_META[kind].label[lang]}
            </button>
          );
        })}
      </div>

      <h2 style={{ fontSize: 14, color: '#475569', margin: '0 0 10px' }}>{tt.overview.viewsTitle}</h2>
      {savedViews.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>{tt.overview.noViews}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {savedViews.map((view) => (
            <button key={view.id} type="button" onClick={() => onNavigate(viewRoute(view.id))} style={{ ...ui.card, padding: '14px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', textAlign: 'left' }}>
              {viewName(view, DEFAULT_SAVED_VIEWS, lang)}
            </button>
          ))}
        </div>
      )}

      {adding && (
        <RecordForm
          kind={adding}
          role={role}
          farmId={farm.id}
          onCancel={() => setAdding(null)}
          onSaved={() => {
            const kind = adding;
            setAdding(null);
            onChanged?.();
            onNavigate(logRoute(kind));
          }}
        />
      )}
    </div>
  );
}
