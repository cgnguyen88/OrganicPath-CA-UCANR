import { useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_META } from '../../domain/records/kinds.js';
import { fieldLabel } from '../../domain/records/labels.js';
import { summarizeRecord } from '../../domain/records/schemas.js';
import { CAPTURE_FILE_ACCEPT, CAPTURE_MAX_FILES, captureRecords, prepareAttachments, replyToRecord } from '../../lib/agent.js';
import { ROUTES } from '../../lib/recordsRoute.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import StatusBadge from './StatusBadge.jsx';

const alertStyle = { padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, marginTop: 12 };
const noticeStyle = { padding: '10px 14px', borderRadius: 8, background: '#fffbeb', color: '#92400e', fontSize: 13, marginTop: 10 };


/** One filed record, with its follow-up questions and an answer box while details are missing. */
function ResultCard({ record, lang, onUpdated }) {
  const tt = recordsText(lang);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState(null);
  const [notice, setNotice] = useState(null);

  async function submitAnswer(event) {
    event.preventDefault();
    const text = answer.trim();
    if (busy || text === '') return;
    setBusy(true);
    setErrorCode(null);
    const { data, error } = await replyToRecord({ recordId: record.id, text, lang });
    setBusy(false);
    if (error) {
      setErrorCode(error.code);
      return;
    }
    setAnswer('');
    setNotice({ message: data.message, applied: data.applied ?? [], rejected: data.rejected ?? [] });
    onUpdated(data.record);
  }

  const waiting = record.status === 'needs_info';
  const meta = KIND_META[record.kind];

  return (
    <div data-testid="capture-result" style={{ ...ui.card, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>{meta.label[lang]}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{summarizeRecord(record, lang)}</span>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>{record.record_date ?? tt.table.noDate}</span>
        <span style={{ marginLeft: 'auto' }}><StatusBadge status={record.status} /></span>
      </div>

      {waiting && record.questions?.text && (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#92400e', whiteSpace: 'pre-line' }}>{record.questions.text}</p>
      )}
      {notice?.message && <p style={{ margin: '10px 0 0', fontSize: 13, color: '#334155' }}>{notice.message}</p>}
      {notice?.applied.length > 0 && (
        <p role="status" style={{ margin: '6px 0 0', fontSize: 12, color: '#166534' }}>
          {tt.capture.updated} {notice.applied.map((key) => fieldLabel(record.kind, key, lang, tt.form.date)).join(', ')}
        </p>
      )}
      {notice?.rejected.length > 0 && (
        <p role="status" style={{ margin: '6px 0 0', fontSize: 12, color: '#92400e' }}>
          {tt.capture.notUsed} {notice.rejected.map((key) => fieldLabel(record.kind, key, lang, tt.form.date)).join(', ')}
        </p>
      )}

      {waiting && (
        <form onSubmit={submitAnswer} style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <input
            aria-label={tt.capture.answerLabel}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={2000}
            style={{ ...ui.input, flex: '1 1 220px', width: 'auto' }}
          />
          <button type="submit" disabled={busy || answer.trim() === ''} style={{ ...ui.buttonPrimary, ...(busy || answer.trim() === '' ? ui.buttonDisabled : {}) }}>
            {busy ? tt.capture.sending : tt.capture.send}
          </button>
        </form>
      )}
      {errorCode && <div role="alert" style={alertStyle}>{tt.capture.errors[errorCode] ?? tt.errors.unknown}</div>}
    </div>
  );
}

/**
 * Capture records from a message and/or photos: the assistant reads them and files records for
 * review, then asks about whatever is missing. It never approves anything.
 */
export default function CapturePanel({ onChanged, onNavigate }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { text } already translated
  const [result, setResult] = useState(null);

  const canSubmit = !busy && (text.trim() !== '' || files.length > 0);

  function chooseFiles(event) {
    const chosen = [...event.target.files];
    event.target.value = ''; // picking the same file again must fire another change event
    const room = CAPTURE_MAX_FILES - files.length;
    setFiles((current) => [...current, ...chosen.slice(0, Math.max(room, 0))]);
    setError(chosen.length > room ? { text: tt.capture.fileErrors.count } : null);
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const prepared = await prepareAttachments(files);
    if (!prepared.ok) {
      setBusy(false);
      setError({ text: tt.capture.fileErrors[prepared.code] ?? tt.errors.unknown });
      return;
    }
    const { data, error: failure } = await captureRecords({ text: text.trim(), attachments: prepared.attachments, lang });
    setBusy(false);
    if (failure) {
      setError({ text: tt.capture.errors[failure.code] ?? tt.errors.unknown });
      return;
    }
    setResult(data);
    if (!data.duplicate && data.records?.length > 0) onChanged?.();
  }

  function reset() {
    setResult(null);
    setText('');
    setFiles([]);
    setError(null);
  }

  const updateRecord = (updated) => {
    setResult((current) => ({ ...current, records: current.records.map((r) => (r.id === updated.id ? updated : r)) }));
    onChanged?.();
  };

  return (
    <section style={{ ...ui.card, padding: '18px 20px', marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, color: 'var(--u-navy)', margin: '0 0 4px' }}>{tt.capture.title}</h2>
      <p style={{ ...ui.subtitle, margin: '0 0 14px', fontSize: 13 }}>{tt.capture.subtitle}</p>

      {result ? (
        <ResultView result={result} lang={lang} onUpdated={updateRecord} onReview={() => onNavigate?.(ROUTES.review)} onReset={reset} />
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="capture-text" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{tt.capture.textLabel}</label>
          <textarea
            id="capture-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tt.capture.textPlaceholder}
            rows={3}
            maxLength={8000}
            style={{ ...ui.input, resize: 'vertical' }}
          />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <label style={{ ...ui.buttonSecondary, cursor: 'pointer' }}>
              {tt.capture.addFile}
              <input type="file" multiple accept={CAPTURE_FILE_ACCEPT} onChange={chooseFiles} style={{ display: 'none' }} />
            </label>
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} style={{ fontSize: 12, color: '#475569', background: '#f1f5f9', borderRadius: 8, padding: '4px 8px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {file.name}
                <button type="button" aria-label={`${tt.capture.removeFile} ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', padding: 0 }}>✕</button>
              </span>
            ))}
            <button type="submit" disabled={!canSubmit} style={{ ...ui.buttonPrimary, marginLeft: 'auto', ...(canSubmit ? {} : ui.buttonDisabled) }}>
              {busy ? tt.capture.reading : tt.capture.submit}
            </button>
          </div>
          {error && <div role="alert" style={alertStyle}>{error.text}</div>}
        </form>
      )}
    </section>
  );
}

function ResultView({ result, lang, onUpdated, onReview, onReset }) {
  const tt = recordsText(lang).capture;
  const records = result.records ?? [];
  const headline = result.duplicate ? tt.duplicate : records.length > 0 ? tt.filed(records.length) : result.refused ? tt.refused : tt.nothing;

  return (
    <div>
      <p role="status" style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{headline}</p>
      {result.message && <p style={{ margin: '0 0 10px', fontSize: 13, color: '#334155', whiteSpace: 'pre-line' }}>{result.message}</p>}
      {result.truncated && <div role="status" style={noticeStyle}>{tt.truncated}</div>}
      {result.tooMany && <div role="status" style={noticeStyle}>{tt.tooMany}</div>}
      {result.skipped > 0 && <div role="status" style={noticeStyle}>{tt.skipped(result.skipped)}</div>}
      {(result.warnings ?? []).filter((code) => tt.warnings[code]).map((code) => <div key={code} role="status" style={noticeStyle}>{tt.warnings[code]}</div>)}

      <div style={{ marginTop: 12 }}>
        {records.map((record) => <ResultCard key={record.id} record={record} lang={lang} onUpdated={onUpdated} />)}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {records.length > 0 && <button type="button" onClick={onReview} style={ui.buttonPrimary}>{tt.openReview}</button>}
        <button type="button" onClick={onReset} style={ui.buttonSecondary}>{tt.newCapture}</button>
      </div>
    </div>
  );
}
