import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Leaf, FlaskConical, Archive } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import streamClaude from './generators/streamClaude.js';
import SubstanceAuditForm from './generators/SubstanceAuditForm.jsx';
import AuditTrailForm from './generators/AuditTrailForm.jsx';
import { generatorsText } from './generators/text.js';
import useAiOutputActions from './useAiOutputActions.js';
import OutputPanel from './generators/OutputPanel.jsx';

const TABS = [
  { id: 'soil', icon: Leaf, labelEn: 'Soil Health Assessment', labelEs: 'Evaluación de Salud del Suelo', color: '#1B6B2E' },
  { id: 'substance', icon: FlaskConical, labelEn: 'Prohibited Substance Audit', labelEs: 'Auditoría de Sustancias Prohibidas', color: '#dc2626' },
  { id: 'audit', icon: Archive, labelEn: '5-Year Audit Trail', labelEs: 'Registro de Auditoría de 5 Años', color: '#7c3aed' },
];

function SoilHealthForm({ lang, profile }) {
  const [form, setForm] = useState({
    fieldName: profile?.operationName || '',
    assessmentDate: new Date().toISOString().split('T')[0],
    county: profile?.county || '',
    acreage: '',
    cropHistory: '',
    soilTexture: '',
    ph: '',
    organicMatter: '',
    lastAmendment: '',
    concerns: '',
  });
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const outputRef = useRef('');
  const tt = generatorsText(lang);
  const actions = useAiOutputActions(output, () => ({
    title: tt.docTitles.soil, subtitle: [form.fieldName, form.assessmentDate].filter(Boolean).join(' · '), markdown: output, lang, filename: `soil-assessment-${form.assessmentDate}`,
  }));

  const labels = lang === 'es' ? {
    fieldName: 'Nombre del Campo / Operación', assessmentDate: 'Fecha de Evaluación',
    county: 'Condado', acreage: 'Acres Evaluados', cropHistory: 'Historial de Cultivos (últimos 3 años)',
    soilTexture: 'Textura del Suelo (ej. franco-arcilloso)', ph: 'pH del Suelo (si disponible)',
    organicMatter: 'Materia Orgánica % (si disponible)', lastAmendment: 'Última Enmienda Aplicada',
    concerns: 'Preocupaciones de Cumplimiento Conocidas', generate: 'Generar Evaluación con Jimmy',
  } : {
    fieldName: 'Field / Operation Name', assessmentDate: 'Assessment Date',
    county: 'County', acreage: 'Acres Assessed', cropHistory: 'Crop History (last 3 years)',
    soilTexture: 'Soil Texture (e.g. clay loam)', ph: 'Soil pH (if available)',
    organicMatter: 'Organic Matter % (if available)', lastAmendment: 'Last Amendment Applied',
    concerns: 'Known Compliance Concerns', generate: 'Generate Assessment with Jimmy',
  };

  const generate = async () => {
    setLoading(true);
    setOutput('');
    setError('');
    outputRef.current = '';
    const prompt = `Generate a complete, professional Soil Health Assessment Record for a California organic operation.

Operation Details:
- Field/Operation Name: ${form.fieldName || 'Not specified'}
- Assessment Date: ${form.assessmentDate}
- County: ${form.county || 'California'}
- Acreage: ${form.acreage || 'Not specified'} acres
- Crop History (last 3 years): ${form.cropHistory || 'Not provided'}
- Soil Texture: ${form.soilTexture || 'Not tested'}
- Soil pH: ${form.ph || 'Not tested'}
- Organic Matter %: ${form.organicMatter || 'Not tested'}
- Last Amendment Applied: ${form.lastAmendment || 'None recorded'}
- Known Compliance Concerns: ${form.concerns || 'None'}

Write a complete assessment record with these sections, each under its own ## heading (keep the numbers):
1. Operation Identification
2. Field Conditions Summary (physical observations, drainage, compaction indicators)
3. Soil Health Indicators Evaluation (rate each: structure, biology, chemistry, water-holding capacity)
4. Organic Matter & Nutrient Management Review (NOP §205.203 compliance)
5. Prohibited Substance Risk Assessment (adjacent land risks, contamination pathways)
6. Soil Building Recommendations (cover crops, compost, tillage practices)
7. Testing Recommendations (lab tests needed, frequency)
8. Compliance Status (NOP §205.203 checklist)
9. Assessor Certification (a blank signature block)

Use today's date. Include specific NOP regulation references.${lang === 'es' ? '\n\nRespond entirely in Spanish.' : ''}`;

    await streamClaude(prompt, (chunk) => {
      outputRef.current += chunk;
      setOutput(outputRef.current);
    }, setError);
    setLoading(false);
  };

  const input = (key) => ({
    value: form[key],
    onChange: e => setForm(f => ({ ...f, [key]: e.target.value })),
    style: {
      width: '100%', padding: '9px 12px', borderRadius: 8,
      border: '1.5px solid #e2e8f0', fontSize: 13,
      fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box',
    },
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: output || error ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.keys(labels).filter(k => k !== 'generate').map(key => (
          <div key={key}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{labels[key]}</label>
            {key === 'cropHistory' || key === 'concerns' ? (
              <textarea rows={2} {...input(key)} style={{ ...input(key).style, resize: 'vertical' }} />
            ) : key === 'assessmentDate' ? (
              <input type="date" {...input(key)} />
            ) : (
              <input type="text" {...input(key)} />
            )}
          </div>
        ))}
        <button
          onClick={generate}
          disabled={loading}
          style={{
            padding: '11px 20px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            background: loading ? '#e2e8f0' : '#1B6B2E', color: loading ? '#94a3b8' : 'white',
            fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Sparkles size={15} />
          {loading ? (lang === 'es' ? 'Generando...' : 'Generating...') : labels.generate}
        </button>
      </div>

      {(output || error) && <OutputPanel output={output} loading={loading} error={error} color="#1B6B2E" actions={actions} labels={tt} />}
    </div>
  );
}

export default function RecordGenerators({ profile, farm, onNavigate }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = generatorsText(lang);
  const [activeTab, setActiveTab] = useState('soil');

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--u-navy)', fontFamily: 'Lora, serif', marginBottom: 6 }}>
          {tt.title}
        </h1>
        <p style={{ color: '#64748b', fontSize: 14 }}>{tt.subtitle}</p>
      </div>

      {/* Tab bar */}
      <div className="tab-strip" style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 12, background: '#f1f5f9', padding: 4, width: 'fit-content' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '9px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? 'white' : 'transparent',
              color: activeTab === tab.id ? tab.color : '#64748b',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: 13, fontFamily: 'Inter, sans-serif',
              boxShadow: activeTab === tab.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            <tab.icon size={14} />
            {lang === 'es' ? tab.labelEs : tab.labelEn}
          </button>
        ))}
      </div>

      {/* Info banner */}
      <div style={{
        padding: '10px 16px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe',
        marginBottom: 22, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#1e40af',
      }}>
        <Sparkles size={15} style={{ flexShrink: 0 }} />
        <span>{tt.banner}</span>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          style={{
            background: 'white', borderRadius: 14, padding: 24,
            border: '1px solid #e2e8f0', boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
          }}
        >
          {activeTab === 'soil' && <SoilHealthForm lang={lang} profile={profile} />}
          {activeTab === 'substance' && <SubstanceAuditForm profile={profile} farm={farm} onNavigate={onNavigate} />}
          {activeTab === 'audit' && <AuditTrailForm profile={profile} farm={farm} onNavigate={onNavigate} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
