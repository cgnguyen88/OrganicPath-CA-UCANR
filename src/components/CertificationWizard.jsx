import { authedFetch } from '../lib/apiClient.js';
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Sparkles, CheckCircle, ChevronDown, Pencil } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import t from '../data/translations.js';
import certifiers from '../data/certifiers.js';
import { SUBSTANCES, calculateStateFee, FEE_TIERS } from '../data/wizard-steps.js';
import { saveToStorage, loadFromStorage } from '../utils/storage.js';
import { debouncedSync } from '../lib/db.js';

const STEP_COLORS = ['#3AA8E4', '#FDBD10', '#1B6B2E', '#005FAE', '#7c3aed', '#bd8e00', '#002D54'];

async function streamClaude(messages, onChunk, system) {
  try {
    const res = await authedFetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system, stream: true }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.delta?.content || json.delta?.text || '';
            if (text) onChunk(text);
          } catch {}
        }
      }
    }
  } catch (err) {
    onChunk('\n[Error generating suggestion. Please try again.]');
  }
}

export default function CertificationWizard({ profile, onUpdateProfile, onNavigate, userId }) {
  const { lang } = useLanguage();
  const tx = t[lang].wizard;
  const totalSteps = 7;

  const [step, setStep] = useState(() => {
    const saved = loadFromStorage('orgpath_wizard_progress');
    return saved?.step || 0;
  });

  const [formData, setFormData] = useState(() => {
    const saved = loadFromStorage('orgpath_wizard_progress');
    return saved?.data || {
      operationName: profile?.operationName || '',
      ownerName: profile?.ownerName || '',
      address: '', city: '', county: '', state: 'CA', zip: '', phone: '', email: '',
      operationType: '', crops: '', acreage: '',
      grossSales: '', registrationPath: '',
      landFreeYears: '', lastProhibitedSubstance: '',
      practices: '', inputs: '', monitoring: '', buffers: '',
      allowedChecked: {}, prohibitedChecked: {},
      certifierName: '', certifierContact: '', certifierId: '',
      registrationNotes: '',
    };
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const aiTextRef = useRef('');

  const update = (key, val) => {
    const next = { ...formData, [key]: val };
    setFormData(next);
    const progress = { step, data: next };
    saveToStorage('orgpath_wizard_progress', progress);
    debouncedSync(userId, 'wizard_progress', progress);
  };

  // Batch-update multiple fields in one setFormData call so none overwrite each other
  const updateMany = (fields) => {
    const next = { ...formData, ...fields };
    setFormData(next);
    const progress = { step, data: next };
    saveToStorage('orgpath_wizard_progress', progress);
    debouncedSync(userId, 'wizard_progress', progress);
  };

  const goNext = () => {
    const nextStep = step + 1;
    setStep(nextStep);
    const progress = { step: nextStep, data: formData };
    saveToStorage('orgpath_wizard_progress', progress);
    debouncedSync(userId, 'wizard_progress', progress);
  };

  const goBack = () => {
    const prevStep = step - 1;
    setStep(prevStep);
    const progress = { step: prevStep, data: formData };
    saveToStorage('orgpath_wizard_progress', progress);
    debouncedSync(userId, 'wizard_progress', progress);
  };

  const handleFinish = () => {
    onUpdateProfile({ ...formData, wizardComplete: true });
    saveToStorage('orgpath_wizard_progress', null);
    debouncedSync(userId, 'wizard_progress', {});
    onNavigate('osp');
  };

  const generateSuggestion = async (field) => {
    if (isGenerating) return;
    setIsGenerating(true);
    aiTextRef.current = '';

    const sysPrompt = `You are Jimmy, a California organic certification expert. The user is completing their Organic System Plan. Based on their operation, provide a practical, concise suggestion in ${lang === 'es' ? 'Spanish' : 'English'}.

Operation: ${formData.operationName || 'Unknown'}, Type: ${formData.operationType || 'crop'}, Crops/Products: ${formData.crops || 'various'}, County: ${formData.county || 'California'}`;

    const prompts = {
      practices: `Suggest 3-4 specific organic production practices appropriate for this operation. Be practical and specific to California conditions.`,
      inputs: `Suggest a list of USDA NOP-compliant inputs and materials appropriate for this operation (fertilizers, pest management, etc). Note any OMRI-listed products.`,
      monitoring: `Suggest monitoring and recordkeeping procedures this operation should implement to maintain organic certification compliance.`,
      buffers: `Suggest physical buffer methods to prevent contamination from non-organic neighboring land for this California operation.`,
    };

    // Clear the field so the user sees text arriving live
    setFormData(prev => ({ ...prev, [field]: '' }));

    await streamClaude(
      [{ role: 'user', content: prompts[field] || 'Provide a helpful suggestion.' }],
      (chunk) => {
        aiTextRef.current += chunk;
        // Update textarea in real-time so user sees streaming output
        setFormData(prev => ({ ...prev, [field]: aiTextRef.current }));
      },
      sysPrompt
    );

    // Persist final value and sync to operation_data so OSP Generator
    // sees the new content immediately (not only after Finish is clicked)
    setFormData(prev => {
      const next = { ...prev, [field]: aiTextRef.current };
      const progress = { step, data: next };
      saveToStorage('orgpath_wizard_progress', progress);
      debouncedSync(userId, 'wizard_progress', progress);
      onUpdateProfile(next);
      return next;
    });

    setIsGenerating(false);
  };

  const estFee = formData.grossSales ? calculateStateFee(formData.grossSales) : null;

  return (
    <div style={{ padding: '40px', maxWidth: 780, margin: '0 auto', paddingBottom: 80 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'Lora, serif', fontSize: 28, color: 'var(--u-navy)', marginBottom: 8 }}>
          {tx.title}
        </h1>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 20 }}>
          {tx.steps.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 20,
              background: i === step ? STEP_COLORS[i] : i < step ? '#e8f5e9' : '#f1f5f9',
              color: i === step ? 'white' : i < step ? '#1B6B2E' : '#94a3b8',
              fontSize: 12, fontWeight: i === step ? 700 : 500,
              transition: 'all 0.2s',
            }}>
              {i < step ? <CheckCircle size={12} /> : <span>{i + 1}</span>}
              <span>{s.title}</span>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginTop: 16 }}>
          <motion.div
            animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
            style={{ height: '100%', background: STEP_COLORS[step], borderRadius: 2 }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
        >
          <div style={{
            background: 'white', borderRadius: 16, padding: '36px',
            boxShadow: '0 4px 24px rgba(0,45,84,0.07)',
            borderTop: `4px solid ${STEP_COLORS[step]}`,
          }}>
            <h2 style={{ fontFamily: 'Lora, serif', fontSize: 22, color: 'var(--u-navy)', marginBottom: 6 }}>
              {tx.steps[step]?.title}
            </h2>
            <p style={{ color: '#64748b', fontSize: 13, marginBottom: 28 }}>
              {tx.steps[step]?.desc}
            </p>

            {step === 0 && <Step0 formData={formData} update={update} tx={tx} lang={lang} />}
            {step === 1 && <Step1 formData={formData} update={update} tx={tx} lang={lang} estFee={estFee} />}
            {step === 2 && <Step2 formData={formData} update={update} tx={tx} />}
            {step === 3 && <Step3 formData={formData} update={update} tx={tx} isGenerating={isGenerating} generateSuggestion={generateSuggestion} />}
            {step === 4 && <Step4 formData={formData} update={update} lang={lang} />}
            {step === 5 && <Step5 formData={formData} update={update} updateMany={updateMany} lang={lang} />}
            {step === 6 && <Step6 formData={formData} update={update} tx={tx} lang={lang} estFee={estFee} />}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button
          onClick={goBack}
          disabled={step === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 22px', borderRadius: 8,
            border: '1.5px solid #e2e8f0', background: 'white',
            cursor: step === 0 ? 'not-allowed' : 'pointer',
            opacity: step === 0 ? 0.4 : 1,
            fontSize: 14, color: '#374151', fontFamily: 'Inter, sans-serif',
          }}
        >
          <ArrowLeft size={16} /> {tx.back}
        </button>

        <button
          onClick={step === totalSteps - 1 ? handleFinish : goNext}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 24px', borderRadius: 8,
            border: 'none', background: STEP_COLORS[step],
            color: step === 5 ? 'var(--u-navy)' : 'white',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {step === totalSteps - 1 ? tx.finish : tx.next}
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Step Components ─────────────────────────────────────────────────────────

function FormField({ label, children, required }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', marginBottom: 6 }}>
        {label} {required && <span style={{ color: 'var(--error)' }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 13px',
  border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 14, fontFamily: 'Inter, sans-serif',
  outline: 'none', transition: 'border-color 0.2s',
  background: 'white',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 120,
};

function Step0({ formData, update, tx, lang }) {
  const f = tx.fields;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <FormField label={f.operationName} required>
          <input style={inputStyle} value={formData.operationName} onChange={e => update('operationName', e.target.value)} />
        </FormField>
        <FormField label={f.ownerName} required>
          <input style={inputStyle} value={formData.ownerName} onChange={e => update('ownerName', e.target.value)} />
        </FormField>
        <FormField label={f.email}>
          <input type="email" style={inputStyle} value={formData.email} onChange={e => update('email', e.target.value)} />
        </FormField>
        <FormField label={f.phone}>
          <input style={inputStyle} value={formData.phone} onChange={e => update('phone', e.target.value)} />
        </FormField>
      </div>
      <FormField label={f.address}>
        <input style={inputStyle} value={formData.address} onChange={e => update('address', e.target.value)} />
      </FormField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 20px' }}>
        <FormField label={f.city}>
          <input style={inputStyle} value={formData.city} onChange={e => update('city', e.target.value)} />
        </FormField>
        <FormField label={f.county}>
          <input style={inputStyle} value={formData.county} onChange={e => update('county', e.target.value)} />
        </FormField>
        <FormField label={f.zip}>
          <input style={inputStyle} value={formData.zip} onChange={e => update('zip', e.target.value)} />
        </FormField>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        <FormField label={f.operationType} required>
          <div style={{ position: 'relative' }}>
            <select style={{ ...inputStyle, appearance: 'none', paddingRight: 32, cursor: 'pointer' }}
              value={formData.operationType} onChange={e => update('operationType', e.target.value)}>
              <option value="">— {lang === 'en' ? 'Select' : 'Seleccionar'} —</option>
              {tx.operationTypes.map(ot => <option key={ot} value={ot}>{ot}</option>)}
            </select>
            <ChevronDown size={16} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
          </div>
        </FormField>
        <FormField label={f.acreage}>
          <input style={inputStyle} value={formData.acreage} onChange={e => update('acreage', e.target.value)} />
        </FormField>
      </div>
      <FormField label={f.crops}>
        <input style={inputStyle} value={formData.crops} onChange={e => update('crops', e.target.value)} placeholder="e.g. tomatoes, lettuce, berries" />
      </FormField>
    </div>
  );
}

function Step1({ formData, update, tx, lang, estFee }) {
  const f = tx.fields;
  const tiers = FEE_TIERS.slice(0, 8);
  return (
    <div>
      <FormField label={f.grossSales} required>
        <input style={inputStyle} type="number" value={formData.grossSales}
          onChange={e => update('grossSales', e.target.value)}
          placeholder="e.g. 45000" />
      </FormField>

      {estFee !== null && (
        <div style={{
          background: '#e5f4fd', borderRadius: 10, padding: '14px 18px',
          border: '1px solid #bae0f7', marginBottom: 20,
        }}>
          <p style={{ fontSize: 14, color: '#003d7a' }}>
            💰 {lang === 'en' ? 'Estimated California state registration fee' : 'Cuota de registro estatal de California estimada'}:
            <strong style={{ marginLeft: 8, fontSize: 16 }}>${estFee}/year</strong>
          </p>
        </div>
      )}

      <FormField label={f.registrationPath}>
        <div style={{ position: 'relative' }}>
          <select style={{ ...inputStyle, appearance: 'none', paddingRight: 32, cursor: 'pointer' }}
            value={formData.registrationPath} onChange={e => update('registrationPath', e.target.value)}>
            <option value="">— {lang === 'en' ? 'Select path' : 'Seleccionar camino'} —</option>
            <option value="CDFA">{lang === 'en' ? 'CDFA (raw ag / livestock / dairy)' : 'CDFA (productos agrícolas crudos / ganado / lácteos)'}</option>
            <option value="CDPH">{lang === 'en' ? 'CDPH (processed foods / supplements)' : 'CDPH (alimentos procesados / suplementos)'}</option>
            <option value="Both">{lang === 'en' ? 'Both CDFA + CDPH' : 'Ambos CDFA + CDPH'}</option>
            <option value="Exempt">{lang === 'en' ? 'Exempt (under $5,000 gross sales)' : 'Exento (menos de $5,000 en ventas brutas)'}</option>
          </select>
          <ChevronDown size={16} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
        </div>
      </FormField>

      <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, border: '1px solid #e2e8f0' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-navy)', marginBottom: 10 }}>
          {lang === 'en' ? '📊 California Fee Schedule (partial)' : '📊 Tabla de Cuotas de California (parcial)'}
        </p>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#e5f0fa' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--u-navy)' }}>
                {lang === 'en' ? 'Gross Sales' : 'Ventas Brutas'}
              </th>
              <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--u-navy)' }}>
                {lang === 'en' ? 'Annual Fee' : 'Cuota Anual'}
              </th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 10px', color: '#374151' }}>{tier.label}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--u-navy)' }}>${tier.fee}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Step2({ formData, update, tx }) {
  const f = tx.fields;
  return (
    <div>
      <FormField label={f.landFreeYears} required>
        <div style={{ position: 'relative' }}>
          <select style={{ ...inputStyle, appearance: 'none', paddingRight: 32, cursor: 'pointer' }}
            value={formData.landFreeYears} onChange={e => update('landFreeYears', e.target.value)}>
            <option value="">— Select —</option>
            <option value="less_than_1">Less than 1 year</option>
            <option value="1_2">1–2 years</option>
            <option value="2_3">2–3 years (approaching transition)</option>
            <option value="3_plus">3 or more years ✅</option>
          </select>
          <ChevronDown size={16} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
        </div>
      </FormField>

      <FormField label={f.lastProhibitedSubstance}>
        <input style={inputStyle} value={formData.lastProhibitedSubstance}
          onChange={e => update('lastProhibitedSubstance', e.target.value)}
          placeholder="e.g. Roundup (glyphosate) — used in 2021" />
      </FormField>

      <div style={{
        background: '#e8f5e9', borderRadius: 10, padding: '14px 18px',
        border: '1px solid #a7d7b2', marginTop: 16,
      }}>
        <p style={{ fontSize: 13, color: '#1B6B2E', lineHeight: 1.7 }}>
          <strong>📅 Transition Timeline:</strong> Your land must be free of prohibited substances for <strong>3 full years</strong> before your first organic harvest. Transition begins the day after the last prohibited substance was applied.
        </p>
      </div>
    </div>
  );
}

function renderOSPMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // H2 / H3 headers
    if (/^###\s/.test(line)) {
      elements.push(<h4 key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--u-navy)', marginTop: 14, marginBottom: 4 }}>{line.replace(/^###\s/, '')}</h4>);
    } else if (/^##\s/.test(line)) {
      elements.push(<h3 key={i} style={{ fontSize: 14, fontWeight: 700, color: 'var(--u-navy)', marginTop: 16, marginBottom: 4 }}>{line.replace(/^##\s/, '')}</h3>);
    } else if (/^#\s/.test(line)) {
      elements.push(<h3 key={i} style={{ fontSize: 15, fontWeight: 700, color: 'var(--u-navy)', marginTop: 16, marginBottom: 4 }}>{line.replace(/^#\s/, '')}</h3>);
    // Numbered list items
    } else if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i} style={{ marginBottom: 4 }}>{formatInline(lines[i].replace(/^\d+\.\s/, ''))}</li>);
        i++;
      }
      elements.push(<ol key={`ol-${i}`} style={{ paddingLeft: 20, margin: '6px 0', lineHeight: 1.7 }}>{items}</ol>);
      continue;
    // Bullet list items (-, *, •)
    } else if (/^[-*•]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        items.push(<li key={i} style={{ marginBottom: 4 }}>{formatInline(lines[i].replace(/^[-*•]\s/, ''))}</li>);
        i++;
      }
      elements.push(<ul key={`ul-${i}`} style={{ paddingLeft: 20, margin: '6px 0', lineHeight: 1.7 }}>{items}</ul>);
      continue;
    // Blank line → spacer
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 6 }} />);
    // Regular paragraph
    } else {
      elements.push(<p key={i} style={{ margin: '4px 0', lineHeight: 1.7 }}>{formatInline(line)}</p>);
    }
    i++;
  }
  return elements;
}

function formatInline(text) {
  // Split on **bold** and *italic* markers and return mixed array
  const parts = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*)/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const raw = match[0];
    if (raw.startsWith('**')) {
      parts.push(<strong key={match.index}>{raw.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={match.index}>{raw.slice(1, -1)}</em>);
    }
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

function Step3({ formData, update, tx, isGenerating, generateSuggestion }) {
  const f = tx.fields;
  const aiFields = ['practices', 'inputs', 'monitoring', 'buffers'];
  const [editingField, setEditingField] = useState(null);

  return (
    <div>
      {aiFields.map(field => {
        const hasContent = !!formData[field];
        const isEditMode = editingField === field;
        const isThisGenerating = isGenerating;

        return (
          <div key={field} style={{ marginBottom: 28 }}>
            {/* Label row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--u-navy)' }}>{f[field]}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {hasContent && !isThisGenerating && (
                  <button
                    onClick={() => setEditingField(isEditMode ? null : field)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 6,
                      border: '1.5px solid #e2e8f0', background: isEditMode ? '#f1f5f9' : 'white',
                      color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    <Pencil size={11} />
                    {isEditMode ? 'Done' : 'Edit'}
                  </button>
                )}
                <button
                  onClick={() => { generateSuggestion(field); setEditingField(null); }}
                  disabled={isThisGenerating}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 12px', borderRadius: 6,
                    border: '1.5px solid var(--u-sky)', background: 'white',
                    color: 'var(--u-sky)', fontSize: 12, fontWeight: 600,
                    cursor: isThisGenerating ? 'not-allowed' : 'pointer',
                    opacity: isThisGenerating ? 0.6 : 1,
                  }}
                >
                  <Sparkles size={12} />
                  {isThisGenerating ? tx.generating : tx.generateSuggestion}
                </button>
              </div>
            </div>

            {/* Rendered markdown view */}
            {hasContent && !isEditMode && (
              <div style={{
                background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10,
                padding: '14px 18px', fontSize: 13, color: '#374151', lineHeight: 1.7,
                minHeight: 80,
              }}>
                {renderOSPMarkdown(formData[field])}
                {isThisGenerating && (
                  <span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--u-sky)', borderRadius: 2, marginLeft: 2, animation: 'blink 0.8s step-end infinite' }} />
                )}
              </div>
            )}

            {/* Textarea for editing or empty state */}
            {(!hasContent || isEditMode) && (
              <textarea
                style={{ ...textareaStyle, ...(isEditMode ? { borderColor: 'var(--u-sky)' } : {}) }}
                value={formData[field]}
                onChange={e => update(field, e.target.value)}
                placeholder={`${tx.generateSuggestion} ↑ or write your own...`}
              />
            )}
          </div>
        );
      })}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}

function Step4({ formData, update, lang }) {
  const toggleAllowed = (label) => {
    const current = formData.allowedChecked || {};
    update('allowedChecked', { ...current, [label]: !current[label] });
  };
  const toggleProhibited = (label) => {
    const current = formData.prohibitedChecked || {};
    update('prohibitedChecked', { ...current, [label]: !current[label] });
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1B6B2E', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            ✅ {lang === 'en' ? 'Allowed Substances' : 'Sustancias Permitidas'}
          </h3>
          {SUBSTANCES.allowed.map((s, i) => (
            <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formData.allowedChecked?.[s.en] || false}
                onChange={() => toggleAllowed(s.en)}
                style={{ marginTop: 2, accentColor: '#1B6B2E' }}
              />
              <span style={{ fontSize: 13, color: '#374151' }}>{lang === 'es' ? s.es : s.en}</span>
            </label>
          ))}
        </div>

        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--error)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            🚫 {lang === 'en' ? 'Prohibited Substances' : 'Sustancias Prohibidas'}
          </h3>
          {SUBSTANCES.prohibited.map((s, i) => (
            <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formData.prohibitedChecked?.[s.en] || false}
                onChange={() => toggleProhibited(s.en)}
                style={{ marginTop: 2, accentColor: '#cc0000' }}
              />
              <span style={{ fontSize: 13, color: '#374151' }}>{lang === 'es' ? s.es : s.en}</span>
            </label>
          ))}
          <div style={{ background: '#fff0f0', borderRadius: 8, padding: '10px 14px', marginTop: 12, border: '1px solid #fecaca' }}>
            <p style={{ fontSize: 12, color: '#cc0000' }}>
              ⚠️ {lang === 'en' ? 'Check any prohibited substances you have used. These must be disclosed and corrected before certification.' : 'Marca cualquier sustancia prohibida que hayas usado. Deben divulgarse y corregirse antes de la certificación.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step5({ formData, update, updateMany, lang }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', marginBottom: 24 }}>
        {certifiers.map(c => {
          const selected = formData.certifierId === c.id;
          return (
            <motion.div
              key={c.id}
              onClick={() => updateMany({
                certifierId: c.id,
                certifierName: c.name,
                certifierContact: `${c.phone} | ${c.website}`,
              })}
              whileHover={{ scale: selected ? 1 : 1.01 }}
              style={{
                padding: '16px', borderRadius: 10, marginBottom: 12, cursor: 'pointer',
                border: selected ? '2px solid var(--u-navy)' : '2px solid #e2e8f0',
                background: selected ? 'rgba(0,45,84,0.07)' : 'white',
                boxShadow: selected
                  ? '0 0 0 3px rgba(0,45,84,0.12), 0 4px 12px rgba(0,45,84,0.1)'
                  : '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all 0.18s',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Selected accent bar */}
              {selected && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  height: 3, background: 'var(--u-navy)', borderRadius: '10px 10px 0 0',
                }} />
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, marginTop: selected ? 4 : 0 }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: selected ? 'var(--u-navy)' : '#1e293b', flex: 1, paddingRight: 8 }}>{c.name}</p>
                {selected && (
                  <div style={{
                    background: 'var(--u-navy)', borderRadius: '50%',
                    width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <CheckCircle size={13} color="white" />
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11, color: selected ? '#475569' : '#64748b', marginBottom: 4 }}>{c.location}</p>
              <p style={{ fontSize: 11, color: '#94a3b8' }}>{c.notes}</p>
              <a href={c.website} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: 'var(--u-sky)', textDecoration: 'none' }}
                onClick={e => e.stopPropagation()}
              >{c.website}</a>
            </motion.div>
          );
        })}
      </div>

      <FormField label={lang === 'en' ? 'Additional certifier notes' : 'Notas adicionales del certificador'}>
        <textarea style={{ ...textareaStyle, minHeight: 80 }}
          value={formData.certifierContact}
          onChange={e => update('certifierContact', e.target.value)}
          placeholder="Phone, email, notes about your certifier..."
        />
      </FormField>
    </div>
  );
}

function Step6({ formData, update, tx, lang, estFee }) {
  const f = tx.fields;
  return (
    <div>
      {/* Summary card */}
      <div style={{ background: '#f8fafc', borderRadius: 12, padding: '20px 24px', marginBottom: 24, border: '1px solid #e2e8f0' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 14 }}>
          📋 {lang === 'en' ? 'Application Summary' : 'Resumen de Solicitud'}
        </h3>
        {[
          { key: lang === 'en' ? 'Operation' : 'Operación', val: formData.operationName },
          { key: lang === 'en' ? 'Type' : 'Tipo', val: formData.operationType },
          { key: lang === 'en' ? 'Registration Path' : 'Camino de Registro', val: formData.registrationPath },
          { key: lang === 'en' ? 'Certifier' : 'Certificador', val: formData.certifierName },
          { key: lang === 'en' ? 'Est. State Fee' : 'Cuota Estatal Est.', val: estFee ? `$${estFee}/year` : '—' },
        ].filter(r => r.val).map(({ key, val }) => (
          <div key={key} style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: '#94a3b8', minWidth: 160 }}>{key}</span>
            <span style={{ color: '#1e293b', fontWeight: 500 }}>{val}</span>
          </div>
        ))}
      </div>

      <FormField label={f.registrationNotes}>
        <textarea style={{ ...textareaStyle, minHeight: 100 }}
          value={formData.registrationNotes}
          onChange={e => update('registrationNotes', e.target.value)}
          placeholder={lang === 'en' ? "Any additional notes, questions, or special circumstances..." : "Notas adicionales, preguntas o circunstancias especiales..."}
        />
      </FormField>

      <div style={{
        background: '#e8f5e9', borderRadius: 10, padding: '16px 20px',
        border: '1px solid #a7d7b2',
      }}>
        <p style={{ fontSize: 14, color: '#1B6B2E', lineHeight: 1.7 }}>
          ✅ {lang === 'en'
            ? 'Click "Finish & Export" to generate your Organic System Plan draft. You can download it as a Word document to share with your certifier.'
            : 'Haz clic en "Finalizar y Exportar" para generar el borrador de tu Plan de Sistema Orgánico. Puedes descargarlo como documento Word para compartir con tu certificador.'}
        </p>
      </div>
    </div>
  );
}
