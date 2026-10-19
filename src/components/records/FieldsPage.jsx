import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { canManageFields, FIELD_KINDS, summarizeFields, unregisteredFieldNames } from '../../domain/records/fields.js';
import { addFieldsByName, deleteField, setFieldActive } from '../../lib/fields.js';
import { recordsText } from './text.js';
import { useFarmFields } from './farmFields.js';
import useFarmRecords from './useFarmRecords.js';
import * as ui from './ui.js';
import FieldDetail from './FieldDetail.jsx';
import FieldForm from './FieldForm.jsx';
import FieldRow from './FieldRow.jsx';
import FoundNotice from './FoundNotice.jsx';

const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0' };
const small = { ...ui.buttonSecondary, padding: '3px 10px', fontSize: 12 };
const alertBox = { margin: '0 0 14px', padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 };
const retryBox = { ...alertBox, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' };
const COLUMNS = ['name', 'area', 'crops', 'records', 'lastApplication', 'lastHarvest', 'status', 'actions'];

/**
 * The farm's fields: the named places things are grown. Everyone can read the list and each field's
 * history; owners and managers add, change, archive and delete. A field that records use cannot be
 * renamed or deleted (the database enforces it, whatever the record's status), only archived.
 */
export default function FieldsPage({ farm, role }) {
  const { lang: rawLang } = useLanguage();
  const tt = recordsText(rawLang === 'es' ? 'es' : 'en').fields;

  const { status, fields, errorCode, reload } = useFarmFields();
  const { status: recordsStatus, records, truncated, reload: reloadRecords } = useFarmRecords({ farmId: farm.id, kinds: FIELD_KINDS });
  const canManage = canManageFields(role);
  const recordsReady = recordsStatus === 'ready';

  const [form, setForm] = useState(null); // null, or { field, nameLocked } (no field when adding)
  const [detailId, setDetailId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState(null);
  const [notice, setNotice] = useState(null);
  // The names the "add them" button has just added: the notice stays hidden until the list has been read again.
  const [justAdded, setJustAdded] = useState('');

  const summaries = useMemo(() => summarizeFields(fields, recordsReady ? records : []), [fields, records, recordsReady]);
  const found = useMemo(
    () => (canManage && recordsReady && status === 'ready' ? unregisteredFieldNames(records, fields) : []),
    [canManage, recordsReady, status, records, fields],
  );
  const foundKey = found.map((entry) => entry.name).join('\n');
  const detail = summaries.find((summary) => summary.field.id === detailId) ?? null;

  async function change(id, action, { deleting = false } = {}) {
    setBusyId(id);
    setProblem(null);
    setNotice(null);
    const result = await action();
    setBusyId(null);
    if (result.error) {
      setProblem(deleting && result.error.code === 'in_use' ? 'in_use_delete' : result.error.code);
      return;
    }
    reload();
  }

  async function addFound() {
    setAdding(true);
    setProblem(null);
    setNotice(null);
    const result = await addFieldsByName(farm.id, found.map((entry) => entry.name));
    setAdding(false);
    if (result.error) {
      setProblem(result.error.code);
      if (result.error.added > 0) reload();
      return;
    }
    setNotice(result.data);
    setJustAdded(foundKey);
    reload();
  }

  const remove = (field) => {
    if (window.confirm(tt.confirmDelete(field.name))) change(field.id, () => deleteField(field.id), { deleting: true });
  };
  const saved = () => {
    setForm(null);
    setProblem(null);
    reload();
  };

  return (
    <div style={ui.page}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: '1 1 320px' }}>
          <h1 style={ui.h1}>{tt.title}</h1>
          <p style={{ ...ui.subtitle, margin: 0 }}>{tt.subtitle}</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setForm({})} style={ui.buttonPrimary}>
            <Plus size={15} aria-hidden="true" />{tt.add}
          </button>
        )}
      </div>

      {!canManage && <p style={{ ...ui.subtitle, margin: '0 0 14px', fontSize: 13 }}>{tt.readOnly}</p>}

      {status === 'error' && (
        <div role="alert" style={retryBox}>
          <span>{errorCode === 'not_set_up' ? tt.errors.not_set_up : tt.errors.load}</span>
          <button type="button" onClick={reload} style={small}>{tt.errors.retry}</button>
        </div>
      )}
      {problem && <div role="alert" style={alertBox}>{tt.errors[problem] ?? tt.errors.unknown}</div>}
      {recordsStatus === 'error' && (
        <div style={{ ...retryBox, background: '#fef3c7', border: 'none', color: '#92400e', fontSize: 12 }}>
          <span>{tt.recordsError}</span>
          <button type="button" onClick={reloadRecords} style={small}>{tt.errors.retry}</button>
        </div>
      )}
      {notice && (
        <p role="status" style={{ fontSize: 13, color: '#166534', background: '#dcfce7', borderRadius: 8, padding: '8px 12px', margin: '0 0 14px' }}>
          {[tt.found.added(notice.added), notice.remaining > 0 ? tt.found.more(notice.remaining) : null].filter(Boolean).join(' ')}
        </p>
      )}

      {found.length > 0 && foundKey !== justAdded && <FoundNotice found={found} adding={adding} onAdd={addFound} />}

      {status === 'loading' && <div style={{ ...ui.card, padding: 32, textAlign: 'center', color: '#94a3b8' }}>{tt.loading}</div>}
      {status === 'ready' && fields.length === 0 && <div style={{ ...ui.card, padding: '36px 24px', textAlign: 'center', color: '#64748b' }}>{tt.empty}</div>}

      {fields.length > 0 && (
        <div style={{ ...ui.card, overflowX: 'auto' }}>
          <table className="stack-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{COLUMNS.map((column) => <th key={column} style={th}>{tt.columns[column]}</th>)}</tr>
            </thead>
            <tbody>
              {summaries.map((summary) => (
                <FieldRow
                  key={summary.field.id}
                  summary={summary}
                  recordsReady={recordsReady}
                  canManage={canManage}
                  busy={busyId === summary.field.id}
                  onDetails={() => setDetailId(summary.field.id)}
                  onEdit={() => setForm({ field: summary.field, nameLocked: summary.uses > 0 })}
                  onToggleActive={() => change(summary.field.id, () => setFieldActive(summary.field.id, !summary.field.is_active))}
                  onDelete={() => remove(summary.field)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && <FieldForm farmId={farm.id} field={form.field} nameLocked={form.nameLocked} onSaved={saved} onCancel={() => setForm(null)} />}
      {detail && <FieldDetail summary={detail} truncated={truncated} onClose={() => setDetailId(null)} />}
    </div>
  );
}
