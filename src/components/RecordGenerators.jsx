import { authedFetch } from '../lib/apiClient.js';
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Download, Copy, CheckCheck, Leaf, FlaskConical, Archive } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';

const TABS = [
  { id: 'soil', icon: Leaf, labelEn: 'Soil Health Assessment', labelEs: 'Evaluación de Salud del Suelo', color: '#1B6B2E' },
  { id: 'substance', icon: FlaskConical, labelEn: 'Prohibited Substance Audit', labelEs: 'Auditoría de Sustancias Prohibidas', color: '#dc2626' },
  { id: 'audit', icon: Archive, labelEn: '5-Year Audit Trail', labelEs: 'Registro de Auditoría de 5 Años', color: '#7c3aed' },
];

async function streamClaude(prompt, onChunk, onError) {
  try {
    const res = await authedFetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        mode: 'record_generator',
        stream: true,
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
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
    onError(err.message);
  }
}

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
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef('');

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

Generate a complete assessment record with these sections:
1. OPERATION IDENTIFICATION HEADER
2. FIELD CONDITIONS SUMMARY (physical observations, drainage, compaction indicators)
3. SOIL HEALTH INDICATORS EVALUATION (rate each: structure, biology, chemistry, water-holding capacity)
4. ORGANIC MATTER & NUTRIENT MANAGEMENT REVIEW (NOP §205.203 compliance)
5. PROHIBITED SUBSTANCE RISK ASSESSMENT (adjacent land risks, contamination pathways)
6. SOIL BUILDING RECOMMENDATIONS (cover crops, compost, tillage practices)
7. TESTING RECOMMENDATIONS (lab tests needed, frequency)
8. COMPLIANCE STATUS (NOP §205.203 checklist)
9. ASSESSOR CERTIFICATION BLOCK

Format as a professional compliance document. Use today's date. Include specific NOP regulation references.${lang === 'es' ? '\n\nRespond entirely in Spanish.' : ''}`;

    await streamClaude(prompt, (chunk) => {
      outputRef.current += chunk;
      setOutput(outputRef.current);
    }, (err) => setOutput(`[Error: ${err}]`));
    setLoading(false);
  };

  const copy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `soil-assessment-${form.assessmentDate}.txt`;
    a.click();
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
    <div style={{ display: 'grid', gridTemplateColumns: output ? '1fr 1fr' : '1fr', gap: 20 }}>
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

      {output && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={copy} style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
              {copied ? <CheckCheck size={13} color="#1B6B2E" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={download} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#1B6B2E', color: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Download size={13} /> Download
            </button>
          </div>
          <div style={{
            flex: 1, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1.5px solid #e2e8f0',
            overflowY: 'auto', maxHeight: 560, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, monospace', color: '#1e293b',
          }}>
            {output}
            {loading && <span style={{ animation: 'caretBlink 0.8s step-end infinite' }}>▋</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function SubstanceAuditForm({ lang, profile }) {
  const [form, setForm] = useState({
    operationName: profile?.operationName || '',
    auditDate: new Date().toISOString().split('T')[0],
    auditPeriod: '12',
    inputs: '',
    purchaseSources: '',
    storageLocations: '',
    applicationRecords: '',
    nonCompliances: '',
  });
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const outputRef = useRef('');

  const generate = async () => {
    setLoading(true);
    setOutput('');
    outputRef.current = '';

    const prompt = `Generate a comprehensive Prohibited Substance Audit Report for a California certified organic operation.

Operation: ${form.operationName || 'California Organic Farm'}
Audit Date: ${form.auditDate}
Audit Period Covered: Last ${form.auditPeriod} months
Inputs/Products Used: ${form.inputs || 'Various agricultural inputs'}
Purchase Sources/Suppliers: ${form.purchaseSources || 'Various'}
Storage Locations: ${form.storageLocations || 'On-farm storage'}
Application Records Available: ${form.applicationRecords || 'Standard farm records'}
Known Non-Compliance Incidents: ${form.nonCompliances || 'None reported'}

Generate a complete audit report with:
1. AUDIT HEADER & SCOPE
2. METHODOLOGY (review process, documents examined)
3. INPUT INVENTORY REVIEW TABLE (for each input: product name, manufacturer, OMRI status, NOP classification, compliance status)
4. PROHIBITED SUBSTANCE SCREENING CHECKLIST
   - Synthetic fertilizers (prohibited under NOP §205.601)
   - Prohibited pesticides/herbicides
   - Prohibited materials on livestock operations
   - GMO/excluded methods check
5. STORAGE & HANDLING REVIEW (commingling risk, contamination prevention)
6. SUPPLIER VERIFICATION STATUS
7. APPLICATION RECORDS COMPLIANCE (required buffer periods, pre-harvest intervals)
8. FINDINGS SUMMARY (pass/fail for each category)
9. CORRECTIVE ACTIONS REQUIRED (if any)
10. AUDITOR CERTIFICATION

Be specific about NOP regulations. Flag any questionable materials. Include a compliance scorecard.${lang === 'es' ? '\n\nRespond entirely in Spanish.' : ''}`;

    await streamClaude(prompt, (chunk) => {
      outputRef.current += chunk;
      setOutput(outputRef.current);
    }, (err) => setOutput(`[Error: ${err}]`));
    setLoading(false);
  };

  const download = () => {
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `substance-audit-${form.auditDate}.txt`;
    a.click();
  };

  const inp = (key, type = 'text') => ({
    value: form[key], type,
    onChange: e => setForm(f => ({ ...f, [key]: e.target.value })),
    style: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' },
  });

  const fields = lang === 'es' ? [
    ['operationName', 'Nombre de la Operación', 'text'], ['auditDate', 'Fecha de Auditoría', 'date'],
    ['auditPeriod', 'Período de Auditoría (meses)', 'number'], ['inputs', 'Insumos Utilizados (lista todos)', 'textarea'],
    ['purchaseSources', 'Fuentes de Compra / Proveedores', 'textarea'], ['storageLocations', 'Ubicaciones de Almacenamiento', 'text'],
    ['applicationRecords', 'Registros de Aplicación Disponibles', 'text'], ['nonCompliances', 'Incidentes de No-Cumplimiento Conocidos', 'textarea'],
  ] : [
    ['operationName', 'Operation Name', 'text'], ['auditDate', 'Audit Date', 'date'],
    ['auditPeriod', 'Audit Period (months)', 'number'], ['inputs', 'Inputs Used (list all)', 'textarea'],
    ['purchaseSources', 'Purchase Sources / Suppliers', 'textarea'], ['storageLocations', 'Storage Locations', 'text'],
    ['applicationRecords', 'Application Records Available', 'text'], ['nonCompliances', 'Known Non-Compliance Incidents', 'textarea'],
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: output ? '1fr 1fr' : '1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map(([key, label, type]) => (
          <div key={key}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{label}</label>
            {type === 'textarea' ? (
              <textarea rows={2} {...inp(key)} style={{ ...inp(key).style, resize: 'vertical' }} />
            ) : (
              <input {...inp(key, type)} />
            )}
          </div>
        ))}
        <button onClick={generate} disabled={loading} style={{
          padding: '11px 20px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? '#e2e8f0' : '#dc2626', color: loading ? '#94a3b8' : 'white',
          fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Sparkles size={15} />
          {loading ? (lang === 'es' ? 'Generando...' : 'Generating...') : (lang === 'es' ? 'Generar Auditoría con Jimmy' : 'Generate Audit with Jimmy')}
        </button>
      </div>
      {output && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={download} style={{ alignSelf: 'flex-end', padding: '6px 12px', borderRadius: 8, border: 'none', background: '#dc2626', color: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
            <Download size={13} /> Download
          </button>
          <div style={{ flex: 1, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1.5px solid #e2e8f0', overflowY: 'auto', maxHeight: 560, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', color: '#1e293b' }}>
            {output}
            {loading && <span style={{ animation: 'caretBlink 0.8s step-end infinite' }}>▋</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditTrailForm({ lang, profile }) {
  const [form, setForm] = useState({
    operationName: profile?.operationName || '',
    certificationYear: new Date().getFullYear(),
    operationType: profile?.operationType || '',
    certifier: profile?.certifierName || '',
    certNumber: '',
    products: '',
    systemDescription: '',
  });
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const outputRef = useRef('');

  const generate = async () => {
    setLoading(true);
    setOutput('');
    outputRef.current = '';

    const prompt = `Generate a comprehensive 5-Year Organic Audit Trail Recordkeeping System Template for a California certified organic operation.

Operation Details:
- Operation Name: ${form.operationName || 'California Organic Operation'}
- Certification Year: ${form.certificationYear}
- Operation Type: ${form.operationType || 'Crop production'}
- Certifying Agent: ${form.certifier || 'USDA-accredited certifier'}
- Certificate Number: ${form.certNumber || 'Pending'}
- Products Certified: ${form.products || 'Various organic crops'}
- Recordkeeping System Description: ${form.systemDescription || 'Paper and digital records'}

Generate a complete 5-Year Audit Trail System with:

1. SYSTEM OVERVIEW & REGULATORY BASIS
   - Reference to NOP §205.103 (recordkeeping requirements)
   - 5-year retention mandate
   - Audit trail definition and purpose

2. MASTER RECORD INDEX (template table for all record categories)

3. ANNUAL RECORDKEEPING CALENDAR (month-by-month checklist)

4. REQUIRED RECORD CATEGORIES WITH TEMPLATES:
   a) Field Activity Log Template (planting, harvesting, field operations)
   b) Input Purchase Records Template (supplier, lot #, OMRI status, quantity)
   c) Input Application Records Template (field, date, rate, applicator)
   d) Sales/Lot Tracking Records Template (buyer, quantity, organic certification disclosure)
   e) Pest Management Activity Log Template
   f) Water/Irrigation Records Template (if applicable)
   g) Supplier Verification File Template
   h) Annual Update Submission Log

5. COMMINGLING PREVENTION RECORDS (NOP §205.272)
   - Separation documentation
   - Parallel production records (if applicable)

6. INSPECTION READINESS CHECKLIST (what to have ready for annual inspection)

7. ELECTRONIC RECORDS POLICY (backup, security, access)

8. RECORD RETENTION SCHEDULE (5-year rolling calendar)

9. SYSTEM CERTIFICATION STATEMENT

Make it comprehensive, practical, and ready to use as an actual compliance system.${lang === 'es' ? '\n\nRespond entirely in Spanish.' : ''}`;

    await streamClaude(prompt, (chunk) => {
      outputRef.current += chunk;
      setOutput(outputRef.current);
    }, (err) => setOutput(`[Error: ${err}]`));
    setLoading(false);
  };

  const download = () => {
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-trail-system-${form.certificationYear}.txt`;
    a.click();
  };

  const inp = (key, type = 'text') => ({
    value: form[key], type,
    onChange: e => setForm(f => ({ ...f, [key]: e.target.value })),
    style: { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' },
  });

  const fields = lang === 'es' ? [
    ['operationName', 'Nombre de la Operación', 'text'], ['certificationYear', 'Año de Certificación', 'number'],
    ['operationType', 'Tipo de Operación', 'text'], ['certifier', 'Agente Certificador', 'text'],
    ['certNumber', 'Número de Certificado', 'text'], ['products', 'Productos Certificados', 'textarea'],
    ['systemDescription', 'Descripción del Sistema de Registros', 'textarea'],
  ] : [
    ['operationName', 'Operation Name', 'text'], ['certificationYear', 'Certification Year', 'number'],
    ['operationType', 'Operation Type (crop/livestock/handler)', 'text'], ['certifier', 'Certifying Agent Name', 'text'],
    ['certNumber', 'Certificate Number', 'text'], ['products', 'Certified Products/Crops', 'textarea'],
    ['systemDescription', 'Recordkeeping System Description', 'textarea'],
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: output ? '1fr 1fr' : '1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map(([key, label, type]) => (
          <div key={key}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{label}</label>
            {type === 'textarea' ? (
              <textarea rows={2} {...inp(key)} style={{ ...inp(key).style, resize: 'vertical' }} />
            ) : (
              <input {...inp(key, type)} />
            )}
          </div>
        ))}
        <button onClick={generate} disabled={loading} style={{
          padding: '11px 20px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? '#e2e8f0' : '#7c3aed', color: loading ? '#94a3b8' : 'white',
          fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Sparkles size={15} />
          {loading ? (lang === 'es' ? 'Generando...' : 'Generating...') : (lang === 'es' ? 'Generar Sistema con Jimmy' : 'Generate Audit Trail System with Jimmy')}
        </button>
      </div>
      {output && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={download} style={{ alignSelf: 'flex-end', padding: '6px 12px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
            <Download size={13} /> Download
          </button>
          <div style={{ flex: 1, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1.5px solid #e2e8f0', overflowY: 'auto', maxHeight: 560, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', color: '#1e293b' }}>
            {output}
            {loading && <span style={{ animation: 'caretBlink 0.8s step-end infinite' }}>▋</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecordGenerators({ profile }) {
  const { lang } = useLanguage();
  const [activeTab, setActiveTab] = useState('soil');

  const title = lang === 'es' ? 'Generadores de Registros' : 'Record Generators';
  const subtitle = lang === 'es'
    ? 'Jimmy genera documentos de cumplimiento profesionales basados en los detalles de tu operación'
    : 'Jimmy generates professional compliance documents based on your operation details';

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--u-navy)', fontFamily: 'Lora, serif', marginBottom: 6 }}>
          {title}
        </h1>
        <p style={{ color: '#64748b', fontSize: 14 }}>{subtitle}</p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 12, background: '#f1f5f9', padding: 4, width: 'fit-content' }}>
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
        <Sparkles size={15} />
        <span>
          {lang === 'es'
            ? 'Jimmy generará un documento listo para usar. Revisa siempre con tu certificador antes de presentarlo.'
            : 'Jimmy will generate a ready-to-use compliance document. Always review with your certifier before submission.'}
        </span>
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
          {activeTab === 'substance' && <SubstanceAuditForm lang={lang} profile={profile} />}
          {activeTab === 'audit' && <AuditTrailForm lang={lang} profile={profile} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
