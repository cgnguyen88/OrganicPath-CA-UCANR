import { useEffect, useState } from 'react';
import { Camera, Plus, Search, X } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_META, RECORD_STATUSES } from '../../domain/records/kinds.js';
import { costSummary, matchesSearch } from '../../domain/records/search.js';
import { listRecords } from '../../lib/records.js';
import { listRecordsForReport } from '../../lib/reportData.js';
import { formatMoney } from './format.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import CapturePanel from './CapturePanel.jsx';
import ExportButton from './ExportButton.jsx';
import Modal from './Modal.jsx';
import RecordDetail from './RecordDetail.jsx';
import RecordForm from './RecordForm.jsx';
import RecordTable from './RecordTable.jsx';

const FILTERABLE = RECORD_STATUSES.filter((s) => s !== 'voided');

/** The log of one kind of record (Harvest Log, Purchases, …). */
export default function RecordLog({ kind, farm, role, userId, operation, needsReviewCount, onChanged, onNavigate }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  // `loaded` remembers which farm/kind it belongs to, so switching logs shows a clean slate
  // without resetting state inside an effect.
  const key = `${farm.id}:${kind}`;
  const [loaded, setLoaded] = useState({ key: null, records: null, error: false });
  const records = loaded.key === key ? loaded.records : null;
  const loadError = loaded.key === key && loaded.error;
  const setRecords = (update) =>
    setLoaded((current) => ({ key, error: false, records: typeof update === 'function' ? update(current.key === key ? current.records : null) : update }));
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    listRecords({ farmId: farm.id, kind }).then(({ data, error }) => {
      if (alive) setLoaded({ key, records: error ? null : data ?? [], error: Boolean(error) });
    });
    return () => { alive = false; };
  }, [farm.id, kind, key]);

  const replace = (updated) => {
    setRecords((current) => (current ?? []).flatMap((r) => (r.id !== updated.id ? [r] : updated.status === 'voided' ? [] : [updated])));
    onChanged?.();
  };

  const visible = (records ?? []).filter((r) => (filter === 'all' || r.status === filter) && matchesSearch(r, query, lang));
  const costs = kind === 'purchase' ? costSummary(visible) : null;
  const label = KIND_META[kind].label[lang];
  const loadForExport = (includeUnapproved) => listRecordsForReport({ farmId: farm.id, kinds: [kind], includeUnapproved });

  return (
    <div style={ui.page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={ui.h1}>{KIND_META[kind].plural[lang]}</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label htmlFor="log-filter" style={{ fontSize: 12, color: '#64748b' }}>{tt.log.filter}</label>
          <select id="log-filter" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ ...ui.input, width: 'auto' }}>
            <option value="all">{tt.log.all}</option>
            {FILTERABLE.map((status) => <option key={status} value={status}>{tt.status[status]}</option>)}
          </select>
          <button type="button" onClick={() => setCapturing(true)} style={ui.buttonSecondary}><Camera size={15} />{tt.log.addFromPhoto}</button>
          <ExportButton title={KIND_META[kind].plural} farm={farm} operation={operation} load={loadForExport} allowUnapproved needsReviewCount={needsReviewCount} />
          <button type="button" disabled={records === null} onClick={() => setAdding(true)} style={{ ...ui.buttonPrimary, ...(records === null ? ui.buttonDisabled : {}) }}><Plus size={15} />{tt.log.add(label)}</button>
        </div>
      </div>

      {loadError && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{tt.errors.load}</div>}
      {records && records.length > 0 && (
        <div style={{ position: 'relative', maxWidth: 360, marginBottom: 14 }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="search"
            aria-label={tt.log.search}
            placeholder={tt.log.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ ...ui.input, paddingLeft: 32, paddingRight: query ? 32 : 12 }}
          />
          {query && (
            <button type="button" aria-label={tt.log.clear} onClick={() => setQuery('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}>
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {costs && costs.counted > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#334155' }}>
          <strong>{tt.log.costTotal(formatMoney(costs.total, lang), visible.length)}</strong>
          {costs.missing > 0 && <><span aria-hidden="true" style={{ color: '#94a3b8' }}> · </span><span style={{ color: '#64748b' }}>{tt.log.costMissing(costs.missing)}</span></>}
        </p>
      )}
      {records && (records.length > 0 && visible.length === 0
        ? <div style={{ ...ui.card, textAlign: 'center', padding: '32px 20px', color: '#94a3b8' }}>{tt.log.noMatches}</div>
        : <RecordTable records={visible} onSelect={setSelected} />)}

      {adding && (
        <RecordForm
          kind={kind}
          role={role}
          farmId={farm.id}
          onCancel={() => setAdding(false)}
          onSaved={(created) => {
            setRecords((current) => [created, ...(current ?? [])]);
            setAdding(false);
            onChanged?.();
          }}
        />
      )}
      {capturing && (
        <Modal title={tt.log.addFromPhotoTitle} onClose={() => setCapturing(false)} maxWidth={720}>
          <CapturePanel onChanged={onChanged} onNavigate={(page) => { setCapturing(false); onNavigate?.(page); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setCapturing(false)} style={ui.buttonSecondary}>{tt.log.close}</button>
          </div>
        </Modal>
      )}
      {selected && <RecordDetail record={selected} role={role} userId={userId} farm={farm} onClose={() => setSelected(null)} onChanged={replace} />}
    </div>
  );
}
