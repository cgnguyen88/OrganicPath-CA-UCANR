import { useRef, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_META, RECORD_KINDS } from '../../domain/records/kinds.js';
import { REPORT_KIND_ORDER } from '../../domain/records/report.js';
import { DATE_MAX, DATE_MIN, isValidIsoDate } from '../../domain/records/schemas.js';
import { seasonPeriod, todayLocalIso } from '../../domain/records/seasons.js';
import { listRecordsForReport } from '../../lib/reportData.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import ReportOutput from './ReportOutput.jsx';

const PERIODS = ['current', 'previous', 'all', 'custom'];
const fieldset = { border: 'none', padding: 0, margin: '0 0 20px' };
const legend = { fontSize: 13, fontWeight: 600, color: '#0f172a', padding: 0, marginBottom: 8 };
const choice = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', padding: '3px 0' };
const linkButton = { background: 'none', border: 'none', padding: 0, color: 'var(--u-navy)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' };
const errorBox = { padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 };
const FAILED = { data: null, error: { code: 'unknown' } };

function PeriodFieldset({ tt, period, onPeriod, seasons, from, to, onFrom, onTo }) {
  const dateInput = (label, value, onChange) => (
    <label style={{ ...choice, flexDirection: 'column', alignItems: 'flex-start' }}>
      {label}
      <input type="date" value={value} min={DATE_MIN} max={DATE_MAX} onChange={(event) => onChange(event.target.value)} style={{ ...ui.input, width: 'auto' }} />
    </label>
  );
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>{tt.period}</legend>
      {PERIODS.map((value) => (
        <label key={value} style={choice}>
          <input type="radio" name="report-period" checked={period === value} onChange={() => onPeriod(value)} />
          {seasons[value] ? `${tt.periods[value]} (${tt.range(seasons[value].from, seasons[value].to)})` : tt.periods[value]}
        </label>
      ))}
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
          {dateInput(tt.from, from, onFrom)}
          {dateInput(tt.to, to, onTo)}
        </div>
      )}
    </fieldset>
  );
}

function KindsFieldset({ tt, lang, kinds, onToggle, onAll, onNone }) {
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>{tt.sections}</legend>
      <div style={{ display: 'flex', gap: 14, marginBottom: 6 }}>
        <button type="button" onClick={onAll} style={linkButton}>{tt.selectAll}</button>
        <button type="button" onClick={onNone} style={linkButton}>{tt.clear}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 2 }}>
        {REPORT_KIND_ORDER.map((kind) => (
          <label key={kind} style={choice}>
            <input type="checkbox" checked={kinds.includes(kind)} onChange={() => onToggle(kind)} />
            {KIND_META[kind].plural[lang]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function WhichFieldset({ tt, includeUnapproved, onChange }) {
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>{tt.which}</legend>
      <label style={choice}><input type="radio" name="report-which" checked={!includeUnapproved} onChange={() => onChange(false)} />{tt.approvedOnly}</label>
      <label style={choice}><input type="radio" name="report-which" checked={includeUnapproved} onChange={() => onChange(true)} />{tt.withUnapproved}</label>
    </fieldset>
  );
}

/** What is wrong with the form, if anything: no log chosen, or dates that are not real or run backwards. */
function formProblem({ kinds, period, from, to }) {
  if (kinds.length === 0) return 'kinds';
  if (period !== 'custom') return null;
  if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to)) || (from && to && from > to)) return 'dates';
  return null;
}

/** Build a report of the farm's records for a period and a choice of logs, to hand to an inspector or certifier. */
export default function ReportsPage({ farm, operation, needsReviewCount = 0 }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang).reports;

  const [today] = useState(() => todayLocalIso());
  const [period, setPeriod] = useState('current');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kinds, setKinds] = useState(RECORD_KINDS);
  const [includeUnapproved, setIncludeUnapproved] = useState(false);
  const [reportLang, setReportLang] = useState(lang);
  const [submitted, setSubmitted] = useState(false);
  const [built, setBuilt] = useState(null);
  const request = useRef(0);

  const { season_start_month: startMonth, season_start_day: startDay } = farm;
  const seasonOf = (offset) => seasonPeriod({ season_start_month: startMonth, season_start_day: startDay }, today, offset);
  const seasons = { current: seasonOf(0), previous: seasonOf(-1) };
  const range = { ...seasons, all: null, custom: { from: from || undefined, to: to || undefined } }[period];

  const problem = formProblem({ kinds, period, from, to });
  const settingsKey = JSON.stringify({ period, range, kinds, includeUnapproved });
  const current = built?.key === settingsKey ? built : null;
  const loading = current?.status === 'loading';

  const toggleKind = (kind) => setKinds((list) => RECORD_KINDS.filter((k) => (k === kind ? !list.includes(k) : list.includes(k))));

  const create = async () => {
    setSubmitted(true);
    if (problem) return;
    const ticket = ++request.current;
    setBuilt({ key: settingsKey, status: 'loading' });
    let result;
    try {
      result = await listRecordsForReport({ farmId: farm.id, kinds, includeUnapproved, from: range?.from, to: range?.to });
    } catch (error) {
      console.error('report export:', error);
      result = FAILED;
    }
    if (ticket !== request.current) return;
    setBuilt({
      key: settingsKey,
      status: result.error ? 'error' : 'ready',
      data: result.data,
      period: range ? { type: 'range', from: range.from, to: range.to } : { type: 'all' },
    });
  };

  return (
    <div style={ui.page}>
      <h1 style={ui.h1}>{tt.title}</h1>
      <p style={{ ...ui.subtitle, marginBottom: 22 }}>{tt.subtitle}</p>

      <div style={{ ...ui.card, padding: 22, marginBottom: 22 }}>
        <h2 style={{ fontSize: 15, color: '#0f172a', margin: '0 0 16px' }}>{tt.settings}</h2>
        <PeriodFieldset tt={tt} period={period} onPeriod={setPeriod} seasons={seasons} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <KindsFieldset tt={tt} lang={lang} kinds={kinds} onToggle={toggleKind} onAll={() => setKinds(RECORD_KINDS)} onNone={() => setKinds([])} />
        <WhichFieldset tt={tt} includeUnapproved={includeUnapproved} onChange={setIncludeUnapproved} />

        {submitted && problem && <div role="alert" style={{ ...errorBox, marginBottom: 14 }}>{tt.errors[problem]}</div>}
        <button type="button" disabled={loading} onClick={create} style={{ ...ui.buttonPrimary, ...(loading ? ui.buttonDisabled : {}) }}>
          {loading ? tt.creating : tt.create}
        </button>
      </div>

      {current?.status === 'error' && <div role="alert" style={errorBox}>{tt.errors.load}</div>}
      {current?.status === 'ready' && (
        <div style={{ ...ui.card, padding: 22 }}>
          <ReportOutput
            records={current.data.records}
            truncated={current.data.truncated}
            farm={farm}
            operation={operation}
            period={current.period}
            includeUnapproved={includeUnapproved}
            needsReviewCount={needsReviewCount}
            lang={reportLang}
            onLangChange={setReportLang}
          />
        </div>
      )}
    </div>
  );
}
