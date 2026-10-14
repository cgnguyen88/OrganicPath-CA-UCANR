import { useEffect, useEffectEvent, useState } from 'react';
import { Download } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import Modal from './Modal.jsx';
import ReportOutput from './ReportOutput.jsx';

const DIALOG_WIDTH = 1100;

/**
 * Gathers the records when it opens, then shows the report output for them. The report is a snapshot:
 * what it is about (title, farm, operation, period) is taken when the dialog opens, so the page behind
 * it re-rendering never rebuilds the report.
 */
function ExportDialog({ title, farm, operation, period, load, allowUnapproved, includeUnapproved: fixedChoice, needsReviewCount, onClose }) {
  const { lang: rawLang } = useLanguage();
  const uiLang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(uiLang);
  const [subject] = useState(() => ({ title, farm, operation, period }));
  const [reportLang, setReportLang] = useState(uiLang); // kept here so choosing again below does not undo it

  const [choice, setChoice] = useState(false);
  const includeUnapproved = fixedChoice ?? choice;
  const [attempt, setAttempt] = useState(0);
  const key = `${includeUnapproved}:${attempt}`;
  const [loaded, setLoaded] = useState({ key: null, result: null });

  const gather = useEffectEvent((flag) => load(flag));
  useEffect(() => {
    let alive = true;
    gather(includeUnapproved).then(
      (result) => {
        if (alive) setLoaded({ key, result });
      },
      (error) => {
        console.error('report export:', error);
        if (alive) setLoaded({ key, result: { data: null, error: { code: 'unknown' } } });
      },
    );
    return () => { alive = false; };
  }, [key, includeUnapproved]);

  const result = loaded.key === key ? loaded.result : null;

  return (
    <Modal title={tt.export.title(subject.title[uiLang])} onClose={onClose} maxWidth={DIALOG_WIDTH}>
      {allowUnapproved && fixedChoice === undefined && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', marginBottom: 14 }}>
          <input type="checkbox" checked={choice} onChange={(event) => setChoice(event.target.checked)} />
          {tt.export.includeUnapproved}
        </label>
      )}

      {result === null && <p role="status" style={{ color: '#64748b', fontSize: 13 }}>{tt.export.loading}</p>}
      {result?.error && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {tt.export.error}
          <button type="button" onClick={() => setAttempt((count) => count + 1)} style={ui.buttonSecondary}>{tt.export.retry}</button>
        </div>
      )}
      {result?.data && (
        <ReportOutput
          records={result.data.records}
          truncated={result.data.truncated}
          farm={subject.farm}
          operation={subject.operation}
          title={subject.title}
          period={subject.period}
          includeUnapproved={includeUnapproved}
          needsReviewCount={needsReviewCount}
          lang={reportLang}
          onLangChange={setReportLang}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="button" onClick={onClose} style={ui.buttonSecondary}>{tt.export.close}</button>
      </div>
    </Modal>
  );
}

/**
 * A "Download" button for a page of records (a log, a saved view). It opens a dialog that gathers the
 * complete set (not just what fits on screen) and offers it as Word, a spreadsheet or PDF.
 *
 * @param {{
 *   title: { en: string, es: string }, farm: object, operation?: object, period?: object | null,
 *   load: (includeUnapproved: boolean) => Promise<{ data: { records: object[], truncated: boolean } | null, error: unknown }>,
 *   allowUnapproved?: boolean, includeUnapproved?: boolean, needsReviewCount?: number,
 * }} props `includeUnapproved` fixes the choice (when the page decides); leave it out with `allowUnapproved` to let the person choose.
 */
export default function ExportButton({ title, farm, operation, period, load, allowUnapproved = false, includeUnapproved, needsReviewCount = 0 }) {
  const { lang: rawLang } = useLanguage();
  const tt = recordsText(rawLang === 'es' ? 'es' : 'en');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={ui.buttonSecondary}><Download size={15} />{tt.export.button}</button>
      {open && (
        <ExportDialog
          title={title}
          farm={farm}
          operation={operation}
          period={period}
          load={load}
          allowUnapproved={allowUnapproved}
          includeUnapproved={includeUnapproved}
          needsReviewCount={needsReviewCount}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
