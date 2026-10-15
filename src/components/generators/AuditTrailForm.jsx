import { useRef, useState } from 'react';
import useAiOutputActions from '../useAiOutputActions.js';
import { Sparkles } from 'lucide-react';
import { KIND_META } from '../../domain/records/kinds.js';
import { coverageStart, summarizeCoverage } from '../../domain/records/coverage.js';
import { todayLocalIso } from '../../domain/records/seasons.js';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { ROUTES } from '../../lib/recordsRoute.js';
import useFarmRecords from '../records/useFarmRecords.js';
import OutputPanel from './OutputPanel.jsx';
import { auditTrailPrompt } from './prompts.js';
import streamClaude from './streamClaude.js';
import { generatorsText } from './text.js';

const COLOR = '#7c3aed';
const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' };
const cell = { padding: '7px 10px', fontSize: 12, borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#334155' };
const head = { ...cell, fontWeight: 700, color: '#475569', background: '#f8fafc', textTransform: 'uppercase', fontSize: 10.5 };
const outlined = { background: 'white', border: '1.5px solid #e2e8f0', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--u-navy)' };

/** Year-by-year counts of approved records for each log: a zero is a gap an inspector may ask about. */
function CoverageTable({ coverage, lang, tt }) {
  const labels = tt.audit.columns;
  return (
    <table aria-label={tt.audit.coverageTitle} style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...head, textAlign: 'left' }}>{labels.log}</th>
          {coverage.years.map((year) => <th key={year} style={head}>{year}</th>)}
          <th style={head}>{labels.total}</th>
          <th style={head}>{labels.first}</th>
          <th style={head}>{labels.last}</th>
        </tr>
      </thead>
      <tbody>
        {coverage.rows.map((row) => (
          <tr key={row.kind}>
            <td style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{KIND_META[row.kind].plural[lang]}</td>
            {coverage.years.map((year) => <td key={year} style={{ ...cell, color: row.counts[year] === 0 ? '#cbd5e1' : '#334155' }}>{row.counts[year]}</td>)}
            <td style={{ ...cell, fontWeight: 700 }}>{row.total}</td>
            <td style={cell}>{row.first ?? '—'}</td>
            <td style={cell}>{row.last ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A 5-year audit-trail system, drafted from what the farm's records actually cover. */
export default function AuditTrailForm({ profile, farm, onNavigate }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = generatorsText(lang);
  const labels = tt.audit.fields;

  const [today] = useState(() => todayLocalIso());
  const { status, records, truncated, reload } = useFarmRecords({ farmId: farm?.id, from: coverageStart(today) });
  const coverage = summarizeCoverage(records, { today });
  const kindsWithRecords = coverage.rows.filter((row) => row.total > 0).length;
  const derivedDescription = status === 'ready' && coverage.total > 0 ? tt.audit.systemDescription(coverage.total, coverage.first, coverage.last, kindsWithRecords) : '';

  const defaults = {
    operationName: profile?.operationName || farm?.name || '',
    certificationYear: String(today.slice(0, 4)),
    operationType: profile?.operationType || '',
    certifier: profile?.certifierName || '',
    certNumber: '',
    products: '',
    systemDescription: derivedDescription,
  };
  const [typed, setTyped] = useState({});
  const value = (key) => typed[key] ?? defaults[key];
  const set = (key) => (event) => setTyped((current) => ({ ...current, [key]: event.target.value }));

  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const outputRef = useRef('');
  const ready = status === 'ready';

  const generate = async () => {
    if (!ready || loading) return;
    setLoading(true);
    outputRef.current = '';
    setOutput('');
    setError('');
    const prompt = auditTrailPrompt({
      operationName: value('operationName'), certificationYear: value('certificationYear'), operationType: value('operationType'), certifier: value('certifier'),
      certNumber: value('certNumber'), products: value('products'), systemDescription: value('systemDescription'), coverage, lang,
    });
    await streamClaude(prompt, (chunk) => {
      outputRef.current += chunk;
      setOutput(outputRef.current);
    }, setError);
    setLoading(false);
  };

  const actions = useAiOutputActions(output, () => ({
    title: tt.docTitles.auditTrail, subtitle: [value('operationName'), value('certificationYear')].filter(Boolean).join(' · '), markdown: output, lang, filename: `audit-trail-system-${value('certificationYear')}`,
  }));

  const field = (key, type, element = 'input') => {
    const id = `audit-${key}`;
    return (
      <div key={key}>
        <label htmlFor={id} style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{labels[key]}</label>
        {element === 'textarea'
          ? <textarea id={id} rows={3} value={value(key)} onChange={set(key)} style={{ ...inputStyle, resize: 'vertical' }} />
          : <input id={id} type={type} value={value(key)} onChange={set(key)} style={inputStyle} />}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: output || error ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section style={{ padding: '14px 16px', borderRadius: 10, background: '#faf5ff', border: '1px solid #e9d5ff' }}>
          <h4 style={{ margin: '0 0 4px', fontSize: 13, color: '#6b21a8' }}>{tt.audit.coverageTitle}</h4>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b' }}>{tt.audit.coverageHelp}</p>
          {truncated && <p role="alert" style={{ margin: '0 0 8px', fontSize: 12, color: '#92400e' }}>{tt.records.truncated}</p>}
          {status === 'loading' && <p role="status" style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{tt.audit.loading}</p>}
          {status === 'error' && (
            <div>
              <p role="alert" style={{ margin: '0 0 8px', fontSize: 13, color: '#b91c1c' }}>{tt.records.error}</p>
              <button type="button" onClick={reload} style={outlined}>{tt.records.retry}</button>
            </div>
          )}
          {ready && (
            <div style={{ overflowX: 'auto' }}>
              {coverage.total === 0 && <p style={{ margin: '0 0 8px', fontSize: 13, color: '#334155' }}>{tt.audit.noRecords}</p>}
              <CoverageTable coverage={coverage} lang={lang} tt={tt} />
              <p style={{ margin: '10px 0 8px', fontSize: 12, color: '#64748b' }}>{tt.audit.reportsHint}</p>
              <button type="button" onClick={() => onNavigate(ROUTES.reports)} style={outlined}>{tt.audit.openReports}</button>
            </div>
          )}
        </section>

        {field('operationName', 'text')}
        {field('certificationYear', 'number')}
        {field('operationType', 'text')}
        {field('certifier', 'text')}
        {field('certNumber', 'text')}
        {field('products', 'text', 'textarea')}
        {field('systemDescription', 'text', 'textarea')}
        <button
          type="button"
          onClick={generate}
          disabled={loading || !ready}
          style={{ padding: '11px 20px', borderRadius: 10, border: 'none', cursor: loading || !ready ? 'not-allowed' : 'pointer', background: loading || !ready ? '#e2e8f0' : COLOR, color: loading || !ready ? '#94a3b8' : 'white', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Sparkles size={15} />
          {loading ? tt.generating : tt.audit.generate}
        </button>
      </div>
      {(output || error) && <OutputPanel output={output} loading={loading} error={error} color={COLOR} actions={actions} labels={tt} />}
    </div>
  );
}
