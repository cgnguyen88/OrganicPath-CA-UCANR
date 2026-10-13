import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_META, RECORD_STATUSES } from '../../domain/records/kinds.js';
import { listRecords } from '../../lib/records.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import RecordDetail from './RecordDetail.jsx';
import RecordForm from './RecordForm.jsx';
import RecordTable from './RecordTable.jsx';

const FILTERABLE = RECORD_STATUSES.filter((s) => s !== 'voided');

/** The log of one kind of record (Harvest Log, Purchases, …). */
export default function RecordLog({ kind, farm, role, userId, onChanged }) {
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

  const visible = (records ?? []).filter((r) => filter === 'all' || r.status === filter);
  const label = KIND_META[kind].label[lang];

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
          <button type="button" disabled={records === null} onClick={() => setAdding(true)} style={{ ...ui.buttonPrimary, ...(records === null ? ui.buttonDisabled : {}) }}><Plus size={15} />{tt.log.add(label)}</button>
        </div>
      </div>

      {loadError && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{tt.errors.load}</div>}
      {records && <RecordTable records={visible} onSelect={setSelected} />}

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
      {selected && <RecordDetail record={selected} role={role} userId={userId} farm={farm} onClose={() => setSelected(null)} onChanged={replace} />}
    </div>
  );
}
