import { useState } from 'react';
import { ClipboardList, ClipboardCheck, History, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { RECORD_KINDS, KIND_META } from '../../domain/records/kinds.js';
import { DEFAULT_SAVED_VIEWS } from '../../domain/records/savedViews.js';
import { ROUTES, logRoute, viewRoute, parseRecordsRoute, isRecordsPage } from '../../lib/recordsRoute.js';
import { recordsText, viewName } from './text.js';
import NavGroup from '../nav/NavGroup.jsx';
import NavItem from '../nav/NavItem.jsx';

/**
 * The "Farm Records" section of the sidebar: overview, the review queue (with its count),
 * the per-kind logs, the farm's pinned saved views, and the change history.
 */
export default function RecordsNav({ activePage, onNavigate, needsReviewCount = 0, savedViews = [] }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  const route = parseRecordsRoute(activePage);
  const [logsOpen, setLogsOpen] = useState(false);
  const showLogs = logsOpen || route?.type === 'log';

  const pinned = savedViews.filter((v) => v.pinned).sort((a, b) => a.position - b.position);

  return (
    <NavGroup id="records" label={tt.nav.section} forceOpen={isRecordsPage(activePage)}>
      <NavItem icon={ClipboardList} label={tt.nav.overview} active={activePage === ROUTES.overview} onClick={() => onNavigate(ROUTES.overview)} />
      <NavItem icon={ClipboardCheck} label={tt.nav.review} badge={needsReviewCount} active={activePage === ROUTES.review} onClick={() => onNavigate(ROUTES.review)} />

      <NavItem
        icon={Layers}
        label={tt.nav.logs}
        expanded={showLogs}
        onClick={() => setLogsOpen((open) => !open)}
        trailing={showLogs ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
      />
      {showLogs && RECORD_KINDS.map((kind) => (
        <NavItem key={kind} indent={2} label={KIND_META[kind].plural[lang]} active={activePage === logRoute(kind)} onClick={() => onNavigate(logRoute(kind))} />
      ))}

      {pinned.length > 0 && (
        <NavGroup id="saved-views" label={tt.nav.views} forceOpen={route?.type === 'view'}>
          {pinned.map((view) => (
            <NavItem key={view.id} indent label={viewName(view, DEFAULT_SAVED_VIEWS, lang)} active={activePage === viewRoute(view.id)} onClick={() => onNavigate(viewRoute(view.id))} />
          ))}
        </NavGroup>
      )}

      <NavItem icon={History} label={tt.nav.history} active={activePage === ROUTES.history} onClick={() => onNavigate(ROUTES.history)} />
    </NavGroup>
  );
}
