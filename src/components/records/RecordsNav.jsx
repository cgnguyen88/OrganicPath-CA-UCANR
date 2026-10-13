import { useState } from 'react';
import { ClipboardList, ClipboardCheck, History, Pin, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { RECORD_KINDS, KIND_META } from '../../domain/records/kinds.js';
import { DEFAULT_SAVED_VIEWS } from '../../domain/records/savedViews.js';
import { ROUTES, logRoute, viewRoute, parseRecordsRoute } from '../../lib/recordsRoute.js';
import { recordsText, viewName } from './text.js';
import { KIND_ICONS } from './icons.js';

const MAX_BADGE = 99;

function NavButton({ icon, color, label, active, onClick, badge, indent, trailing }) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? 'page' : undefined}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: `7px 10px 7px ${indent ? 22 : 10}px`, borderRadius: 9, border: 'none', cursor: 'pointer', marginBottom: 1,
        background: active ? 'linear-gradient(90deg, rgba(253,189,16,0.22) 0%, rgba(253,189,16,0.06) 100%)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px rgba(253,189,16,0.25)' : 'none',
        color: active ? '#fff' : 'rgba(255,255,255,0.65)',
        fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: active ? 600 : 400, textAlign: 'left',
      }}
    >
      <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? color : `${color}33` }}>
        <Icon size={13} strokeWidth={active ? 2.2 : 1.8} color={active ? '#fff' : color} />
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge > 0 && (
        <span style={{ minWidth: 20, padding: '1px 6px', borderRadius: 10, background: '#f59e0b', color: '#1c1917', fontSize: 11, fontWeight: 700, textAlign: 'center' }}>
          {badge > MAX_BADGE ? `${MAX_BADGE}+` : badge}
        </span>
      )}
      {trailing}
    </button>
  );
}

/**
 * The "Farm Records" section of the sidebar: overview, the review queue (with its count),
 * the per-kind logs, the farm's pinned saved views, and the change history.
 */
export default function RecordsNav({ activePage, onNavigate, needsReviewCount = 0, savedViews = [] }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  const onLogPage = parseRecordsRoute(activePage)?.type === 'log';
  const [logsOpen, setLogsOpen] = useState(false);
  const showLogs = logsOpen || onLogPage;

  const pinned = savedViews.filter((v) => v.pinned).sort((a, b) => a.position - b.position);

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', marginBottom: 8 }}>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(255,255,255,0.12), transparent)' }} />
        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{tt.nav.section}</span>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12))' }} />
      </div>

      <NavButton icon={ClipboardList} color="#14b8a6" label={tt.nav.overview} active={activePage === ROUTES.overview} onClick={() => onNavigate(ROUTES.overview)} />
      <NavButton icon={ClipboardCheck} color="#f59e0b" label={tt.nav.review} badge={needsReviewCount} active={activePage === ROUTES.review} onClick={() => onNavigate(ROUTES.review)} />

      <NavButton
        icon={Layers}
        color="#64748b"
        label={tt.nav.logs}
        active={false}
        onClick={() => setLogsOpen((open) => !open)}
        trailing={showLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      />
      {showLogs && RECORD_KINDS.map((kind) => (
        <NavButton
          key={kind}
          indent
          icon={KIND_ICONS[KIND_META[kind].icon]}
          color={KIND_META[kind].color}
          label={KIND_META[kind].plural[lang]}
          active={activePage === logRoute(kind)}
          onClick={() => onNavigate(logRoute(kind))}
        />
      ))}

      {pinned.map((view) => (
        <NavButton
          key={view.id}
          icon={Pin}
          color="#a78bfa"
          label={viewName(view, DEFAULT_SAVED_VIEWS, lang)}
          active={activePage === viewRoute(view.id)}
          onClick={() => onNavigate(viewRoute(view.id))}
        />
      ))}

      <NavButton icon={History} color="#94a3b8" label={tt.nav.history} active={activePage === ROUTES.history} onClick={() => onNavigate(ROUTES.history)} />
    </div>
  );
}
