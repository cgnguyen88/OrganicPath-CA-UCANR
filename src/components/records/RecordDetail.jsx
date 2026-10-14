import { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_FIELDS, KIND_META, optionLabel } from '../../domain/records/kinds.js';
import { availableActions, canEditRecord } from '../../domain/records/workflow.js';
import { getAttachmentUrl } from '../../lib/db.js';
import { listRevisions, setRecordStatus } from '../../lib/records.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import Modal from './Modal.jsx';
import RecordForm from './RecordForm.jsx';
import StatusBadge from './StatusBadge.jsx';
import UnknownFieldHint from './UnknownFieldHint.jsx';

const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : null);

function Row({ label, children }) {
  return (
    <div data-testid="detail-row" style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
      <div style={{ width: 170, flexShrink: 0, color: '#64748b' }}>{label}</div>
      <div style={{ flex: 1, color: '#0f172a', wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

/** Action buttons offered for each target status, in display order. */
const ACTIONS = [
  { to: 'approved', key: 'approve', style: ui.buttonSuccess, text: (tt) => tt.review.approve },
  { to: 'rejected', key: 'reject', style: ui.buttonDanger, text: (tt) => tt.review.reject },
  { to: 'needs_info', key: 'askInfo', style: ui.buttonSecondary, text: (tt) => tt.review.askInfo },
  { to: 'pending_review', key: 'markReady', style: ui.buttonSecondary, text: (tt, from, role) => (role === 'crew' ? tt.form.submit : from === 'rejected' ? tt.detail.reopen : tt.detail.markReady) },
  { to: 'voided', key: 'void', style: ui.buttonDanger, text: (tt) => tt.detail.void },
];

/**
 * One record in full: its fields, status, history, and the actions this person is allowed
 * to take. Only actions that will succeed are offered; the database enforces the same rules.
 */
export default function RecordDetail({ record, role, userId, farm, onClose, onChanged }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  const [current, setCurrent] = useState(record);
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    listRevisions({ farmId: farm.id, recordId: record.id }).then(({ data }) => alive && setRevisions(data ?? []));
    return () => { alive = false; };
  }, [farm.id, record.id, current.version]);

  const kind = current.kind;
  const fields = KIND_FIELDS[kind];
  const label = (key) => fields.find((f) => f.key === key)?.label[lang] ?? key;
  const transitions = availableActions(current, role, userId);

  async function change(status) {
    if (status === 'voided' && !window.confirm(tt.detail.voidHint)) return;
    setBusy(true);
    setError(null);
    const result = await setRecordStatus(current.id, status);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setCurrent(result.data);
    onChanged?.(result.data);
  }

  async function openFile(file) {
    setError(null);
    const url = await getAttachmentUrl(file);
    if (!url) {
      setError({ code: 'file' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  if (editing) {
    return (
      <RecordForm
        kind={kind}
        role={role}
        farmId={farm.id}
        record={current}
        onCancel={() => setEditing(false)}
        onSaved={(updated) => {
          setCurrent(updated);
          setEditing(false);
          onChanged?.(updated);
        }}
      />
    );
  }

  const present = fields.filter((f) => current.payload?.[f.key] !== undefined && current.payload?.[f.key] !== null && current.payload?.[f.key] !== '');

  return (
    <Modal title={KIND_META[kind].label[lang]} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <StatusBadge status={current.status} />
        <span style={{ color: '#64748b', fontSize: 12 }}>{current.record_date ?? tt.table.noDate}</span>
      </div>

      {present.map((f) => (
        <Row key={f.key} label={f.label[lang]}>
          {f.type === 'select' ? optionLabel(kind, f.key, current.payload[f.key], lang) : String(current.payload[f.key])}
          {f.key === 'field' && <UnknownFieldHint name={current.payload[f.key]} farmId={farm.id} role={role} />}
        </Row>
      ))}

      {current.missing_fields?.length > 0 && (
        <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '8px 12px', margin: '12px 0' }}>
          {tt.detail.missing} {current.missing_fields.map((k) => (k === 'record_date' ? tt.form.date : label(k))).join(', ')}
        </p>
      )}

      {current.attachments?.length > 0 && (
        <Row label={tt.detail.sourceFile}>
          {current.attachments.map((file, index) => (
            <button key={file.path} type="button" onClick={() => openFile(file)} style={{ ...ui.buttonSecondary, padding: '3px 10px', marginRight: 6 }}>
              {tt.detail.viewFile(index + 1)}
            </button>
          ))}
        </Row>
      )}

      <div style={{ marginTop: 12 }}>
        <Row label={tt.detail.source}>{tt.source[current.source] ?? current.source}</Row>
        {current.confidence !== null && current.confidence !== undefined && <Row label={tt.detail.confidence}>{`${Math.round(current.confidence * 100)}%`}</Row>}
        {dateOnly(current.created_at) && <Row label={tt.detail.created}>{dateOnly(current.created_at)}</Row>}
        {dateOnly(current.reviewed_at) && <Row label={tt.detail.reviewed}>{dateOnly(current.reviewed_at)}</Row>}
      </div>

      <h3 style={{ fontSize: 13, color: '#475569', margin: '18px 0 6px' }}>{tt.detail.history}</h3>
      {revisions.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 12 }}>{tt.detail.noHistory}</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {revisions.map((rev) => (
            <li key={rev.id} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '4px 0', color: '#475569' }}>
              <span style={{ width: 28, color: '#94a3b8' }}>{tt.history.version(rev.version)}</span>
              <span style={{ flex: 1 }}>{tt.changeTypes[rev.change_type] ?? rev.change_type}</span>
              <span style={{ color: '#94a3b8' }}>{dateOnly(rev.changed_at)}</span>
            </li>
          ))}
        </ol>
      )}

      {error && (
        <div role="alert" style={{ margin: '14px 0 0', padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 }}>
          {tt.errors[error.code] ?? tt.errors.unknown}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 18 }}>
        {ACTIONS.filter((a) => transitions.includes(a.to)).map((a) => (
          <button key={a.key} type="button" disabled={busy} onClick={() => change(a.to)} style={{ ...a.style, ...(busy ? ui.buttonDisabled : {}) }}>
            {a.text(tt, current.status, role)}
          </button>
        ))}
        {canEditRecord(current, role, userId) && (
          <button type="button" onClick={() => setEditing(true)} style={ui.buttonSecondary}>{tt.detail.edit}</button>
        )}
        <button type="button" onClick={onClose} style={ui.buttonSecondary}>{tt.detail.close}</button>
      </div>
    </Modal>
  );
}
