import { useMemo, useState } from 'react';
import AiText from '../AiText.jsx';
import { AlertTriangle, CheckCheck, CheckCircle, Info, Layers, Plus, RefreshCw, Search, X } from 'lucide-react';
import { authedFetch } from '../../lib/apiClient.js';
import { optionLabel } from '../../domain/records/kinds.js';
import { materialsForPrompt, verificationDue } from '../../domain/records/materials.js';
import { todayLocalIso } from '../../domain/records/seasons.js';
import { logRoute } from '../../lib/recordsRoute.js';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { loadFromStorage, saveToStorage } from '../../utils/storage.js';
import { maintenanceText } from './text.js';
import useFarmMaterials, { materialsSince } from './useFarmMaterials.js';

const MANUAL_KEY = 'orgpath_manual_inputs';
const DUE_COLORS = { overdue: '#e11d48', 'due-soon': '#d97706', ok: '#64748b', unknown: '#64748b' };

const outlined = { background: 'white', border: '1.5px solid #e2e8f0', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--u-navy)' };
const badge = (background, color) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, background, color, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 });

/** A category by name: purchases and the Input List each have their own list of categories. */
function categoryLabel(value, lang) {
  if (!value) return '—';
  const purchase = optionLabel('purchase', 'category', value, lang);
  return purchase !== value ? purchase : optionLabel('input', 'category', value, lang);
}

function OmriBadge({ material, tt }) {
  if (material.statusConflict) return <span style={badge('#fff7ed', '#c2410c')}><AlertTriangle size={12} /> {tt.omri.conflict}</span>;
  if (material.omriStatus === 'listed') return <span style={badge('#ecfdf5', '#10b981')}><CheckCircle size={12} /> {tt.omri.listed}</span>;
  if (material.omriStatus === 'not_listed') return <span style={badge('#fff1f2', '#e11d48')}><AlertTriangle size={12} /> {tt.omri.not_listed}</span>;
  if (material.omriStatus === 'not_applicable') return <span style={badge('#f8fafc', '#64748b')}>{tt.omri.not_applicable}</span>;
  return <span style={badge('#f8fafc', '#94a3b8')}>{tt.omri.unknown}</span>;
}

function MaterialsTable({ materials, lang, today, tt }) {
  const columns = tt.verification.columns;
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1.5px solid #e2e8f0', overflow: 'hidden', marginBottom: 24 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
            {[columns.material, columns.supplier, columns.category, columns.lastUsed, columns.omri].map((heading) => (
              <th key={heading} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => {
            const last = m.lastPurchased ?? m.lastDate;
            const due = verificationDue(last, today);
            return (
              <tr key={m.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, color: 'var(--u-navy)' }}>
                  {m.name}
                  {m.onInputList && <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontWeight: 500, marginTop: 2 }}>{tt.verification.onInputList}</span>}
                </td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: '#64748b' }}>{m.suppliers.join(', ') || '—'}</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ background: '#f1f5f9', color: '#475569', fontSize: 11, padding: '3px 8px', borderRadius: 20, fontWeight: 600 }}>{categoryLabel(m.category, lang)}</span>
                </td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: DUE_COLORS[due] }}>
                  {last ?? '—'}
                  {due === 'overdue' && <span style={{ fontSize: 10, display: 'block', fontWeight: 600, marginTop: 2 }}>{tt.verification.verifyThisYear}</span>}
                  {due === 'due-soon' && <span style={{ fontSize: 10, display: 'block', fontWeight: 600, marginTop: 2 }}>{tt.verification.reviewSoon}</span>}
                </td>
                <td style={{ padding: '14px 16px' }}><OmriBadge material={m} tt={tt} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ManualPanel({ value, onChange, onSave, saved, onClose, tt }) {
  return (
    <div style={{ marginBottom: 24, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label htmlFor="manual-inputs" style={{ fontSize: 13, fontWeight: 700, color: 'var(--u-navy)' }}>{tt.manual.title}</label>
        {onClose && <button type="button" onClick={onClose} aria-label={tt.manual.close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}><X size={16} /></button>}
      </div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{tt.manual.help}</p>
      <textarea
        id="manual-inputs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        placeholder={tt.manual.placeholder}
        style={{ width: '100%', padding: 12, borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 12 }}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={!value.trim()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: saved ? '#10b981' : value.trim() ? 'var(--u-navy)' : '#94a3b8', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: value.trim() ? 'pointer' : 'not-allowed' }}
      >
        {saved ? <><CheckCheck size={14} /> {tt.manual.saved}</> : tt.manual.save}
      </button>
      <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>{tt.manual.persists}</span>
    </div>
  );
}

/** What Jimmy is asked: the farm's own records, and nothing to be made up where they are silent. */
function verificationPrompt({ materials, manual, lang }) {
  const sections = [
    materials.length > 0 ? `INPUTS FROM THE FARM'S OWN RECORDS ("not recorded" means the farm has not recorded it):\n${materialsForPrompt(materials)}` : '',
    manual.trim() ? `INPUTS TYPED IN BY THE FARM (no other details known):\n${manual.trim()}` : '',
  ].filter(Boolean);
  return `Review these inputs from a USDA-certified organic operation. For each material:
1. Confirm if it is typically OMRI-listed or NOP-compliant
2. Note any known restrictions or annotation requirements under §205.601–606
3. Flag any re-verification steps needed for the upcoming certification year

${sections.join('\n\n')}

Use only the information listed above. Do not invent suppliers, dates, products or listing numbers; where something is not recorded, say so.

Present the result as a Markdown table with one row per input and these columns: Material, Status, Restrictions or annotation, Re-verification needed. Status is Clear, Review or Issue. Then add a "## Priority Actions" section of 2–3 lines on the most urgent actions.${lang === 'es' ? '\n\nRespond entirely in Spanish.' : ''}`;
}

/** The yearly check of a certified farm's materials, worked out from its Farm Records. */
export default function InputVerification({ farm, onNavigate }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = maintenanceText(lang);

  const [today] = useState(() => todayLocalIso());
  const { status, materials, truncated, reload } = useFarmMaterials(farm?.id, useMemo(() => materialsSince(today), [today]));

  const [manual, setManual] = useState(() => loadFromStorage(MANUAL_KEY, ''));
  const [manualOpen, setManualOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState('');
  const [problem, setProblem] = useState('');

  const showManual = manualOpen || (status !== 'loading' && materials.length === 0);
  const canVerify = materials.length > 0 || manual.trim().length > 0;

  const saveManual = () => {
    saveToStorage(MANUAL_KEY, manual);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const verify = async () => {
    if (!canVerify || verifying) return;
    setVerifying(true);
    setResult('');
    setProblem('');
    try {
      const response = await authedFetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: verificationPrompt({ materials, manual, lang }) }], mode: 'input_verification', stream: false }),
      });
      if (!response.ok) throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
      const data = await response.json();
      const text = data.content?.[0]?.text || data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response');
      setResult(text);
    } catch (error) {
      setProblem(error.message);
    } finally {
      setVerifying(false);
    }
  };

  if (status === 'loading') {
    return (
      <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#64748b', gap: 12 }}>
        <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
        {tt.loading}
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  const manualPanel = (
    <ManualPanel value={manual} onChange={setManual} onSave={saveManual} saved={justSaved} tt={tt} onClose={materials.length > 0 ? () => setManualOpen(false) : null} />
  );

  if (status === 'error') {
    return (
      <div>
        <div role="alert" style={{ padding: 24, background: '#fee2e2', borderRadius: 12, border: '1px solid #fecaca', color: '#991b1b', marginBottom: 24 }}>
          <h4 style={{ fontWeight: 700, marginBottom: 6 }}>{tt.loadErrorTitle}</h4>
          <p style={{ fontSize: 13, marginBottom: 12 }}>{tt.loadErrorBody}</p>
          <button type="button" onClick={reload} style={outlined}>{tt.retry}</button>
        </div>
        {manualPanel}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 4 }}>{tt.verification.title}</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            {materials.length > 0 ? tt.verification.fromRecords(materials.length) : tt.verification.noMaterials}
            {manual.trim() && materials.length > 0 ? ` ${tt.verification.manualIncluded}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={verify}
          disabled={verifying || !canVerify}
          style={{ background: verifying || !canVerify ? '#94a3b8' : '#f97316', color: 'white', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: verifying || !canVerify ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        >
          {verifying ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> {tt.verification.analyzing}</> : <><Search size={16} /> {tt.verification.verify}</>}
        </button>
      </div>

      {truncated && <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: '#fffbeb', color: '#92400e', fontSize: 13, marginBottom: 16 }}>{tt.truncated}</div>}

      {materials.length > 0 ? (
        <MaterialsTable materials={materials} lang={lang} today={today} tt={tt} />
      ) : (
        <div style={{ background: '#f8fafc', border: '2px dashed #e2e8f0', borderRadius: 12, padding: 28, textAlign: 'center', marginBottom: 24 }}>
          <Layers size={28} color="#cbd5e1" style={{ margin: '0 auto 10px' }} />
          <h4 style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 6 }}>{tt.verification.emptyTitle}</h4>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 440, margin: '0 auto 14px' }}>{tt.verification.emptyBody}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onNavigate(logRoute('purchase'))} style={outlined}>{tt.openPurchases}</button>
            <button type="button" onClick={() => onNavigate(logRoute('input'))} style={outlined}>{tt.openInputs}</button>
          </div>
        </div>
      )}

      {materials.length > 0 && (
        <button type="button" onClick={() => setManualOpen((open) => !open)} style={{ ...outlined, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          {manualOpen ? <><X size={14} /> {tt.verification.hideManual}</> : <><Plus size={14} /> {tt.verification.addManual}</>}
        </button>
      )}
      {showManual && manualPanel}

      {problem && (
        <div style={{ marginBottom: 20, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 10, padding: 16, fontSize: 13, color: '#991b1b' }}>
          <strong>{tt.verification.error}</strong> {problem}
        </div>
      )}
      {result && (
        <div style={{ marginBottom: 24, background: '#f5f3ff', border: '1.5px solid #ddd6fe', borderRadius: 12, padding: 24 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, color: '#4c1d95', marginBottom: 12 }}>{tt.verification.resultTitle}</h4>
          <AiText text={result} variant="chat" />
        </div>
      )}
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>{tt.verification.caution}</p>

      <div style={{ padding: 20, background: '#fff7ed', borderRadius: 12, border: '1px solid #ffedd5' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Info size={18} color="#c2410c" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 4 }}>{tt.verification.seedTitle}</h4>
            <p style={{ fontSize: 13, color: '#9a3412', lineHeight: 1.5, marginBottom: 10 }}>{tt.verification.seedBody}</p>
            <button type="button" onClick={() => onNavigate(logRoute('seed'))} style={outlined}>{tt.verification.openSeed}</button>
          </div>
        </div>
      </div>

      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
