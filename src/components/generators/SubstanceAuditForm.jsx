import { useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { Sparkles } from 'lucide-react';
import { applicationSummary } from '../../domain/records/materials.js';
import { isValidIsoDate } from '../../domain/records/schemas.js';
import { monthsBefore, todayLocalIso } from '../../domain/records/seasons.js';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import useFarmMaterials from '../maintenance/useFarmMaterials.js';
import FarmRecordsPanel from './FarmRecordsPanel.jsx';
import OutputPanel from './OutputPanel.jsx';
import { substanceAuditPrompt } from './prompts.js';
import streamClaude from './streamClaude.js';
import { generatorsText } from './text.js';

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 120;
const COLOR = '#dc2626';
const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' };

/** A whole number of months from 1 to 120, or the default for anything else. */
function validMonths(text) {
  const months = Number(text);
  return Number.isInteger(months) && months >= 1 && months <= MAX_MONTHS ? months : DEFAULT_MONTHS;
}

/** A prohibited-substance audit, drafted from the farm's materials and applications as they are recorded. */
export default function SubstanceAuditForm({ profile, farm, onNavigate }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = generatorsText(lang);
  const labels = tt.substance.fields;

  const [today] = useState(() => todayLocalIso());
  const [typed, setTyped] = useState({});
  const value = (key, fallback = '') => typed[key] ?? fallback;
  const set = (key) => (event) => setTyped((current) => ({ ...current, [key]: event.target.value }));

  const operationName = value('operationName', profile?.operationName || farm?.name || '');
  const typedDate = value('auditDate', today);
  const auditDate = isValidIsoDate(typedDate) ? typedDate : today;
  const months = validMonths(value('auditPeriod', String(DEFAULT_MONTHS)));
  const from = monthsBefore(auditDate, months);

  const { status, materials, records, truncated, reload } = useFarmMaterials(farm?.id, from);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const outputRef = useRef('');

  const generate = async () => {
    if (status !== 'ready' || loading) return;
    setLoading(true);
    outputRef.current = '';
    setOutput('');
    const prompt = substanceAuditPrompt({
      operationName, auditDate, months, from, materials, summary: applicationSummary(records),
      typedInputs: value('inputs'), storage: value('storageLocations'), nonCompliances: value('nonCompliances'), lang,
    });
    await streamClaude(prompt, (chunk) => {
      outputRef.current += chunk;
      setOutput(outputRef.current);
    }, (message) => setOutput(`[Error: ${message}]`));
    setLoading(false);
  };

  const download = () => saveAs(new Blob([output], { type: 'text/plain;charset=utf-8' }), `substance-audit-${auditDate}.txt`);

  const field = (key, type, element = 'input') => {
    const id = `substance-${key}`;
    const shared = { id, value: value(key, key === 'operationName' ? operationName : key === 'auditDate' ? typedDate : key === 'auditPeriod' ? String(DEFAULT_MONTHS) : ''), onChange: set(key), style: inputStyle };
    return (
      <div key={key}>
        <label htmlFor={id} style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{labels[key]}</label>
        {element === 'textarea' ? <textarea rows={2} {...shared} style={{ ...inputStyle, resize: 'vertical' }} /> : <input type={type} {...shared} />}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: output ? '1fr 1fr' : '1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {field('operationName', 'text')}
        {field('auditDate', 'date')}
        {field('auditPeriod', 'number')}
        <FarmRecordsPanel lang={lang} status={status} materials={materials} records={records} truncated={truncated} reload={reload} onNavigate={onNavigate} />
        {field('inputs', 'text', 'textarea')}
        {field('storageLocations', 'text')}
        {field('nonCompliances', 'text', 'textarea')}
        <button
          type="button"
          onClick={generate}
          disabled={loading || status !== 'ready'}
          style={{ padding: '11px 20px', borderRadius: 10, border: 'none', cursor: loading || status !== 'ready' ? 'not-allowed' : 'pointer', background: loading || status !== 'ready' ? '#e2e8f0' : COLOR, color: loading || status !== 'ready' ? '#94a3b8' : 'white', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Sparkles size={15} />
          {loading ? tt.generating : tt.substance.generate}
        </button>
      </div>
      {output && <OutputPanel output={output} loading={loading} color={COLOR} label={tt.download} onDownload={download} />}
    </div>
  );
}
