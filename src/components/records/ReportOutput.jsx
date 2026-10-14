import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, FileText, Printer } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { buildReport, recordsToCsvRows, reportFileName, reviewChecks } from '../../domain/records/report.js';
import { todayLocalIso } from '../../domain/records/seasons.js';
import { downloadCsv } from '../../lib/reportCsv.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import ReportView from './ReportView.jsx';

/** The on-screen preview shows this many rows of each log; the files and the print-out hold everything. */
const PREVIEW_ROWS = 25;

const LANGUAGES = [{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }];

/**
 * Printing a report. `printing` is true from the request until the print window closes: that is when the
 * print copy of the report exists. While the window is open the page shows only that copy (a class on the
 * body switches the print styles on). A counter makes every request run, even two in a row.
 *
 * @returns {{ printing: boolean, requestPrint: () => void }}
 */
function usePrintReport() {
  const [printing, setPrinting] = useState(false);
  const [job, setJob] = useState(0);

  useEffect(() => {
    if (job === 0) return undefined;
    const finish = () => {
      document.body.classList.remove('printing-report');
      setPrinting(false);
    };
    document.body.classList.add('printing-report');
    window.addEventListener('afterprint', finish, { once: true });
    window.print();
    return () => {
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('printing-report');
    };
  }, [job]);

  const requestPrint = () => {
    setPrinting(true);
    setJob((count) => count + 1);
  };
  return { printing, requestPrint };
}

/** Things worth a look before the report is handed over (shown here only, never written into the report). */
function ChecksNote({ title, notes }) {
  if (notes.length === 0) return null;
  return (
    <section aria-label={title} style={{ padding: '12px 16px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 13, color: '#92400e' }}>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#78350f', lineHeight: 1.6 }}>
        {notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </section>
  );
}

/**
 * Everything that happens once a set of records has been gathered: pick the report language, see a
 * preview, get a note about anything worth checking first, and save it as a Word file, a spreadsheet,
 * or (through the browser's print window) a PDF.
 *
 * `title` is `{ en, es }` so that it can follow the language chosen for the report. The report language
 * is the component's own unless a parent passes `lang` and `onLangChange` to keep it across reloads.
 *
 * @param {{
 *   records: object[], truncated?: boolean, farm: object, operation?: object, title?: { en: string, es: string },
 *   period?: object | null, includeUnapproved?: boolean, needsReviewCount?: number,
 *   lang?: 'en' | 'es', onLangChange?: (lang: 'en' | 'es') => void,
 * }} props
 */
export default function ReportOutput({
  records, truncated = false, farm, operation = {}, title, period = null, includeUnapproved = false, needsReviewCount = 0, lang: chosenLang, onLangChange,
}) {
  const { lang: rawLang } = useLanguage();
  const uiLang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(uiLang).reports;
  const languageId = useId();

  const [ownLang, setOwnLang] = useState(uiLang);
  const lang = chosenLang ?? ownLang;
  const changeLang = (next) => (onLangChange ? onLangChange(next) : setOwnLang(next));

  const [generatedOn] = useState(() => todayLocalIso());
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const { printing, requestPrint } = usePrintReport();

  const titleText = title?.[lang];
  const report = useMemo(
    () => buildReport({ records, farm, operation, title: titleText, period, lang, generatedOn, includeUnapproved, truncated }),
    [records, farm, operation, titleText, period, lang, generatedOn, includeUnapproved, truncated],
  );
  const checks = useMemo(() => reviewChecks(records), [records]);
  const nothing = report.total === 0;
  const fileName = (ext) => reportFileName({ farm, scope: titleText, generatedOn, ext, partial: truncated });
  const previewCut = report.sections.some((section) => section.rows.length > PREVIEW_ROWS);
  const notes = [
    ...checks.map(({ code, count }) => tt.checks[code](count)),
    ...(!includeUnapproved && needsReviewCount > 0 ? [tt.checks.waiting(needsReviewCount)] : []),
  ];

  const print = () => {
    if (!working) requestPrint();
  };

  const saveWord = async () => {
    if (working) return;
    setFailed(false);
    setWorking(true);
    try {
      const { downloadReportDocx } = await import('../../lib/reportDocx.js');
      await downloadReportDocx(report, fileName('docx'));
    } catch (error) {
      console.error('report (Word):', error);
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };

  const saveCsv = () => {
    if (working) return;
    setFailed(false);
    try {
      downloadCsv(recordsToCsvRows(records, lang, { includeUnapproved, truncated }), fileName('csv'));
    } catch (error) {
      console.error('report (CSV):', error);
      setFailed(true);
    }
  };

  // While a file is being made the buttons are "disabled" for people but stay focusable, so keyboard
  // focus is not thrown away mid-action. With nothing to put in a report they are disabled outright.
  const action = (onClick) => ({
    type: 'button',
    disabled: nothing,
    'aria-disabled': working || undefined,
    onClick,
    style: { ...ui.buttonSecondary, ...(nothing || working ? ui.buttonDisabled : {}) },
  });

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <p role="status" style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{tt.output.count(report.total)}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor={languageId} style={{ fontSize: 12, color: '#64748b' }}>{tt.output.language}</label>
          <select id={languageId} value={lang} onChange={(event) => changeLang(event.target.value)} style={{ ...ui.input, width: 'auto' }}>
            {LANGUAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
        <button {...action(saveWord)}><FileText size={15} />{working ? tt.output.working : tt.output.word}</button>
        <button {...action(print)}><Printer size={15} />{tt.output.pdf}</button>
        <button {...action(saveCsv)}><FileDown size={15} />{tt.output.csv}</button>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>{tt.output.pdfHint}</p>

      {failed && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, marginBottom: 14 }}>{tt.output.downloadError}</div>}
      {truncated && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fffbeb', color: '#92400e', fontSize: 13, marginBottom: 14 }}>{tt.output.truncated}</div>}

      <ChecksNote title={tt.checks.title} notes={notes} />

      {nothing ? (
        <div style={{ ...ui.card, textAlign: 'center', padding: '32px 20px', color: '#94a3b8' }}>{tt.output.empty}</div>
      ) : (
        <>
          <h3 style={{ margin: '0 0 4px', fontSize: 13, color: '#475569' }}>{tt.output.preview}</h3>
          {previewCut && <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b' }}>{tt.output.previewCut(PREVIEW_ROWS)}</p>}
        </>
      )}
      <div style={{ background: '#f1f5f9', padding: 12, borderRadius: 12, overflowX: 'auto', ...(nothing ? { marginTop: 12 } : {}) }}>
        <ReportView report={report} maxRows={PREVIEW_ROWS} />
      </div>

      {printing && createPortal(<div className="print-only"><ReportView report={report} /></div>, document.body)}
    </div>
  );
}
