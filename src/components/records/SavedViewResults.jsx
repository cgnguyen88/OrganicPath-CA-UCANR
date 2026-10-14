import { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { DEFAULT_SAVED_VIEWS, parseViewFilter, viewIncludesUnapproved, viewPeriod } from '../../domain/records/savedViews.js';
import { todayLocalIso } from '../../domain/records/seasons.js';
import { listSavedViewRecords } from '../../lib/records.js';
import { listSavedViewRecordsForReport } from '../../lib/reportData.js';
import { recordsText, viewName } from './text.js';
import * as ui from './ui.js';
import ExportButton from './ExportButton.jsx';
import RecordDetail from './RecordDetail.jsx';
import RecordTable from './RecordTable.jsx';

/** The records matching one saved view, e.g. "This season's sprays". */
export default function SavedViewResults({ view, farm, role, userId, operation, needsReviewCount, onChanged }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  // Depend on plain values, not object identity: the parent re-creates `farm` and `view` objects
  // on every refresh, and that must not refetch the results.
  const { id: farmId, season_start_month: startMonth, season_start_day: startDay } = farm;
  const { id: viewId } = view;
  const filterJson = JSON.stringify(view.filter);
  const key = `${farmId}:${viewId}:${filterJson}:${startMonth}:${startDay}`;

  const [loaded, setLoaded] = useState({ key: null, records: null, error: false });
  const records = loaded.key === key ? loaded.records : null;
  const loadError = loaded.key === key && loaded.error;
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    const ctxFarm = { id: farmId, season_start_month: startMonth, season_start_day: startDay };
    listSavedViewRecords({ id: viewId, filter: JSON.parse(filterJson) }, { farm: ctxFarm, today: todayLocalIso() }).then(({ data, error }) => {
      if (alive) setLoaded({ key, records: error ? null : data ?? [], error: Boolean(error) });
    });
    return () => { alive = false; };
  }, [key, farmId, viewId, filterJson, startMonth, startDay]);

  const replace = (updated) => {
    setLoaded((current) => ({ ...current, records: (current.records ?? []).flatMap((r) => (r.id !== updated.id ? [r] : updated.status === 'voided' ? [] : [updated])) }));
    onChanged?.();
  };

  const name = viewName(view, DEFAULT_SAVED_VIEWS, lang);
  const names = { en: viewName(view, DEFAULT_SAVED_VIEWS, 'en'), es: viewName(view, DEFAULT_SAVED_VIEWS, 'es') };
  const exportContext = { farm: { id: farmId, season_start_month: startMonth, season_start_day: startDay }, today: todayLocalIso() };
  const loadForExport = () => listSavedViewRecordsForReport(view, exportContext);
  const parsedFilter = parseViewFilter(view.filter); // a stored filter can be anything: no download for one that is not valid

  return (
    <div style={ui.page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={ui.h1}>{name}</h1>
        {parsedFilter.ok && (
          <ExportButton
            title={names}
            farm={farm}
            operation={operation}
            period={viewPeriod(parsedFilter.value, exportContext)}
            includeUnapproved={viewIncludesUnapproved(parsedFilter.value)}
            load={loadForExport}
            needsReviewCount={needsReviewCount}
          />
        )}
      </div>
      {loadError && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{tt.errors.load}</div>}
      {records && (records.length === 0
        ? <div style={{ ...ui.card, textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>{tt.views.empty}</div>
        : <RecordTable records={records} showKind onSelect={setSelected} />)}
      {selected && <RecordDetail record={selected} role={role} userId={userId} farm={farm} onClose={() => setSelected(null)} onChanged={replace} />}
    </div>
  );
}
