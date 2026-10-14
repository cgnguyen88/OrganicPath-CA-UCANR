import { useState } from 'react';
import { ClipboardList, ClipboardCheck, History, Layers, ChevronDown, ChevronRight, Sprout, Pin } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { RECORD_KINDS, KIND_META } from '../../domain/records/kinds.js';
import { DEFAULT_SAVED_VIEWS } from '../../domain/records/savedViews.js';
import { ROUTES, logRoute, viewRoute, parseRecordsRoute } from '../../lib/recordsRoute.js';
import { recordsText, viewName } from './text.js';
import NavGroup from '../nav/NavGroup.jsx';
import NavItem from '../nav/NavItem.jsx';

// Each main section has its own quiet accent, so they are easy to tell apart at a glance.
const RECORDS_ACCENT = '#4fd1a5';
const VIEWS_ACCENT = '#b69cff';

/**
 * The farm-records part of the sidebar, as two sections of their own: "Farm Records" (overview, the
 * review queue with its count, the per-kind logs, the change history) and "Saved Views" (the farm's
 * pinned shortcuts).
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
    <>
      <NavGroup id="records" label={tt.nav.section} icon={Sprout} accent={RECORDS_ACCENT} forceOpen={Boolean(route) && route.type !== 'view'}>
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

        <NavItem icon={History} label={tt.nav.history} active={activePage === ROUTES.history} onClick={() => onNavigate(ROUTES.history)} />
      </NavGroup>

      {pinned.length > 0 && (
        <NavGroup id="saved-views" label={tt.nav.views} icon={Pin} accent={VIEWS_ACCENT} count={pinned.length} forceOpen={route?.type === 'view'}>
          {pinned.map((view) => (
            <NavItem key={view.id} indent wrap label={viewName(view, DEFAULT_SAVED_VIEWS, lang)} active={activePage === viewRoute(view.id)} onClick={() => onNavigate(viewRoute(view.id))} />
          ))}
        </NavGroup>
      )}
    </>
  );
}
