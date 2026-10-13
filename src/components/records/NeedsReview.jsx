import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_FIELDS, KIND_META } from '../../domain/records/kinds.js';
import { summarizeRecord } from '../../domain/records/schemas.js';
import { canReview } from '../../domain/records/workflow.js';
import { listRecords, setRecordStatus } from '../../lib/records.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import RecordDetail from './RecordDetail.jsx';
import StatusBadge from './StatusBadge.jsx';

const QUEUE_STATUSES = ['pending_review', 'needs_info'];

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 14, color: '#475569', margin: '0 0 10px' }}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * The review queue: records waiting for an owner or manager, and records waiting for the
 * author to supply missing details. Crew see the same list read-only.
 */
export default function NeedsReview({ farm, role, userId, onChanged }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  const [records, setRecords] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    listRecords({ farmId: farm.id, statuses: QUEUE_STATUSES }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setLoadError(true);
      else setRecords(data ?? []);
    });
    return () => { alive = false; };
  }, [farm.id]);

  const applyUpdate = useCallback((updated) => {
    setRecords((current) => (current ?? []).flatMap((r) => (r.id !== updated.id ? [r] : QUEUE_STATUSES.includes(updated.status) ? [updated] : [])));
    onChanged?.();
  }, [onChanged]);

  async function act(record, status) {
    setBusyId(record.id);
    setActionError(null);
    const result = await setRecordStatus(record.id, status);
    setBusyId(null);
    if (result.error) {
      setActionError(result.error);
      return;
    }
    applyUpdate(result.data);
  }

  const reviewer = canReview(role);
  const missingLabels = (record) =>
    (record.missing_fields ?? []).map((k) => (k === 'record_date' ? tt.form.date : KIND_FIELDS[record.kind].find((f) => f.key === k)?.label[lang] ?? k)).join(', ');

  const renderItem = (record) => (
    <div key={record.id} data-testid="review-item" style={{ ...ui.card, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: KIND_META[record.kind].color }}>{KIND_META[record.kind].label[lang]}</span>
        <button type="button" onClick={() => setSelected(record)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#0f172a', textAlign: 'left' }}>
          {summarizeRecord(record, lang)}
        </button>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>{record.record_date ?? tt.table.noDate}</span>
        <span style={{ marginLeft: 'auto' }}><StatusBadge status={record.status} /></span>
      </div>

      {record.status === 'needs_info' && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#92400e' }}>
          <span style={{ fontWeight: 600 }}>{tt.review.waitingInfo}</span>{' '}
          {record.missing_fields?.length > 0 && <span>{missingLabels(record)}</span>}
        </div>
      )}

      {reviewer && record.status === 'pending_review' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" disabled={busyId === record.id} onClick={() => act(record, 'approved')} style={{ ...ui.buttonSuccess, ...(busyId === record.id ? ui.buttonDisabled : {}) }}>{tt.review.approve}</button>
          <button type="button" disabled={busyId === record.id} onClick={() => act(record, 'rejected')} style={{ ...ui.buttonDanger, ...(busyId === record.id ? ui.buttonDisabled : {}) }}>{tt.review.reject}</button>
          <button type="button" disabled={busyId === record.id} onClick={() => act(record, 'needs_info')} style={{ ...ui.buttonSecondary, ...(busyId === record.id ? ui.buttonDisabled : {}) }}>{tt.review.askInfo}</button>
        </div>
      )}
    </div>
  );

  const pending = (records ?? []).filter((r) => r.status === 'pending_review');
  const info = (records ?? []).filter((r) => r.status === 'needs_info');

  return (
    <div style={ui.page}>
      <h1 style={ui.h1}>{tt.review.title}</h1>
      <p style={{ ...ui.subtitle, marginBottom: 20 }}>{tt.review.subtitle}</p>
      {!reviewer && <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>{tt.review.crewNote}</p>}

      {loadError && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{tt.errors.load}</div>}
      {actionError && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, marginBottom: 14 }}>{tt.errors[actionError.code] ?? tt.errors.unknown}</div>}

      {records && records.length === 0 && (
        <div style={{ ...ui.card, textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>{tt.review.empty}</div>
      )}
      {pending.length > 0 && <Section title={tt.review.sectionPending}>{pending.map(renderItem)}</Section>}
      {info.length > 0 && <Section title={tt.review.sectionInfo}>{info.map(renderItem)}</Section>}

      {selected && (
        <RecordDetail record={selected} role={role} userId={userId} farm={farm} onClose={() => setSelected(null)} onChanged={applyUpdate} />
      )}
    </div>
  );
}
