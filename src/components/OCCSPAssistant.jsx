import { authedFetch } from '../lib/apiClient.js';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, Sparkles, DollarSign, ExternalLink, ChevronDown, ChevronRight, Download, AlertCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import { saveToStorage, loadFromStorage } from '../utils/storage.js';
import { getProfile, debouncedSync } from '../lib/db.js';

const STORAGE_KEY = 'orgpath_occsp';

const CHECKLIST_ITEMS = [
  {
    id: 'occ_1',
    category: 'Eligibility',
    title: { en: 'Confirm You Are USDA Certified Organic', es: 'Confirmar que Eres Certificado Orgánico USDA' },
    desc: { en: 'OCCSP is only available to operations that are currently USDA certified organic. You must have an active organic certificate from an accredited certifying agent.', es: 'OCCSP solo está disponible para operaciones que actualmente están certificadas orgánicamente por el USDA. Debes tener un certificado orgánico activo de un agente certificador acreditado.' },
    tip: { en: 'Exempted operations (under $5K gross sales) do NOT qualify for OCCSP. You must be certified.', es: 'Las operaciones exentas (menos de $5K en ventas brutas) NO califican para OCCSP. Debes estar certificado.' },
  },
  {
    id: 'occ_2',
    category: 'Eligibility',
    title: { en: 'Check OCCSP Funding Availability', es: 'Verificar Disponibilidad de Fondos OCCSP' },
    desc: { en: 'OCCSP is a cost-share program funded by USDA through the Farm Bill. Funding is limited and distributed on a first-come, first-served basis each fiscal year.', es: 'OCCSP es un programa de participación de costos financiado por el USDA a través de la Ley Agrícola. El financiamiento es limitado y se distribuye por orden de llegada cada año fiscal.' },
    tip: { en: 'Apply as early as possible after the announcement date. Contact your state OCCSP office (CDFA_Organic@cdfa.ca.gov) to confirm current funding availability.', es: 'Solicita lo antes posible después de la fecha de anuncio. Contacta a la oficina OCCSP de tu estado (CDFA_Organic@cdfa.ca.gov) para confirmar la disponibilidad de fondos actual.' },
  },
  {
    id: 'occ_3',
    category: 'Eligibility',
    title: { en: 'Understand Reimbursement Limits', es: 'Entender los Límites de Reembolso' },
    desc: { en: 'OCCSP reimburses up to 75% of your certification costs, up to $750 per certification per year. If you have multiple certifications (e.g., crops + handling), each qualifies separately up to $750.', es: 'OCCSP reembolsa hasta el 75% de tus costos de certificación, hasta $750 por certificación por año. Si tienes múltiples certificaciones (ej. cultivos + manejo), cada una califica por separado hasta $750.' },
    tip: { en: 'Eligible costs include: application fees, annual renewal fees, certification inspection fees. Does NOT cover travel expenses, consultation fees, or fees for non-certification activities.', es: 'Los costos elegibles incluyen: tarifas de solicitud, tarifas de renovación anual, tarifas de inspección de certificación. NO cubre gastos de viaje, tarifas de consultoría o tarifas por actividades no relacionadas con la certificación.' },
  },
  {
    id: 'occ_4',
    category: 'Documents',
    title: { en: 'Gather Certified Copy of Current Organic Certificate', es: 'Reunir Copia Certificada del Certificado Orgánico Actual' },
    desc: { en: 'You must submit a copy of your current, valid organic certificate issued by your certifying agent. This shows you are currently certified and the certificate dates.', es: 'Debes enviar una copia de tu certificado orgánico actual y válido emitido por tu agente certificador. Esto muestra que estás actualmente certificado y las fechas del certificado.' },
    tip: { en: 'Request a certified copy from your ACA. Some certifiers send electronic copies — confirm with your state office if electronic copies are accepted.', es: 'Solicita una copia certificada a tu ACA. Algunos certificadores envían copias electrónicas — confirma con la oficina de tu estado si se aceptan copias electrónicas.' },
  },
  {
    id: 'occ_5',
    category: 'Documents',
    title: { en: 'Collect Certification Expense Documents', es: 'Recopilar Documentos de Gastos de Certificación' },
    desc: { en: 'Gather ALL invoices, receipts, and billing statements from your certifying agent for costs paid during the applicable time period.', es: 'Reúne TODAS las facturas, recibos y estados de cuenta de tu agente certificador por costos pagados durante el período de tiempo aplicable.' },
    tip: { en: 'Eligible expense documents include: application invoices, inspection fee invoices, annual fee invoices. Organize by date and type. Keep originals — submit copies.', es: 'Los documentos de gastos elegibles incluyen: facturas de solicitud, facturas de tarifas de inspección, facturas de tarifas anuales. Organiza por fecha y tipo. Conserva los originales — envía copias.' },
  },
  {
    id: 'occ_6',
    category: 'Documents',
    title: { en: 'Complete STD 204 Form (Payee Data Record)', es: 'Completar Formulario STD 204 (Registro de Datos del Beneficiario)' },
    desc: { en: 'California requires a STD 204 Payee Data Record to process your reimbursement payment. This form collects your tax information and payment preferences.', es: 'California requiere un Registro de Datos del Beneficiario STD 204 para procesar tu pago de reembolso. Este formulario recopila tu información fiscal y preferencias de pago.' },
    tip: { en: 'Download the STD 204 form from the California Department of Finance website. Complete all fields including federal tax ID or SSN. Sign and date. Required for first-time applicants and when information changes.', es: 'Descarga el formulario STD 204 del sitio web del Departamento de Finanzas de California. Completa todos los campos incluyendo el número de identificación fiscal federal o SSN. Firma y fecha. Requerido para solicitantes por primera vez y cuando la información cambia.' },
    link: 'https://www.dof.ca.gov/Accounting/Policies_and_Procedures/Statewide_Accounting_Manual/Resources/std204.pdf',
    linkText: { en: 'Download STD 204 Form', es: 'Descargar Formulario STD 204' },
  },
  {
    id: 'occ_7',
    category: 'Application',
    title: { en: 'Contact California CDFA OCCSP Office', es: 'Contactar la Oficina OCCSP de CDFA California' },
    desc: { en: 'Contact the California CDFA to request the current OCCSP application packet and confirm this year\'s filing period and deadlines.', es: 'Contacta a CDFA California para solicitar el paquete de solicitud OCCSP actual y confirmar el período de presentación y plazos de este año.' },
    tip: { en: 'Contact: CDFA_Organic@cdfa.ca.gov | Phone: (916) 900-5201 | CDFA Organic Program, 1220 N Street, Sacramento, CA 95814', es: 'Contacto: CDFA_Organic@cdfa.ca.gov | Teléfono: (916) 900-5201 | Programa Orgánico de CDFA, 1220 N Street, Sacramento, CA 95814' },
    link: 'https://www.cdfa.ca.gov/is/i_&_c/organic.html',
    linkText: { en: 'CDFA Organic Program', es: 'Programa Orgánico CDFA' },
  },
  {
    id: 'occ_8',
    category: 'Application',
    title: { en: 'Complete OCCSP Application', es: 'Completar Solicitud OCCSP' },
    desc: { en: 'Fill out the OCCSP application form completely. Include operation name, address, certifier info, certificate number, and itemized expense list.', es: 'Llena el formulario de solicitud OCCSP completamente. Incluye nombre de la operación, dirección, información del certificador, número de certificado y lista detallada de gastos.' },
    tip: { en: 'Double-check all arithmetic on expense totals. Incomplete applications are returned and may miss the deadline. Have someone review before submission.', es: 'Verifica dos veces todos los cálculos en los totales de gastos. Las solicitudes incompletas son devueltas y pueden perder el plazo. Haz que alguien revise antes de enviar.' },
  },
  {
    id: 'occ_9',
    category: 'Application',
    title: { en: 'Submit Application Packet', es: 'Enviar Paquete de Solicitud' },
    desc: { en: 'Assemble and submit your complete OCCSP application packet to CDFA before the deadline.', es: 'Ensambla y envía tu paquete completo de solicitud OCCSP a CDFA antes del plazo.' },
    tip: { en: 'Packet should include: (1) Completed OCCSP application, (2) Copy of current organic certificate, (3) All expense invoices/receipts, (4) Completed STD 204 form. Send via certified mail or email per CDFA instructions. Keep copies of everything submitted.', es: 'El paquete debe incluir: (1) Solicitud OCCSP completa, (2) Copia del certificado orgánico actual, (3) Todas las facturas/recibos de gastos, (4) Formulario STD 204 completo. Enviar por correo certificado o correo electrónico según las instrucciones de CDFA. Conserva copias de todo lo enviado.' },
  },
  {
    id: 'occ_10',
    category: 'Follow-up',
    title: { en: 'Track Application Status', es: 'Rastrear el Estado de la Solicitud' },
    desc: { en: 'After submitting, follow up with CDFA to confirm receipt and track the status of your reimbursement.', es: 'Después de enviar, comunícate con CDFA para confirmar la recepción y rastrear el estado de tu reembolso.' },
    tip: { en: 'Processing typically takes 60-120 days. If you have not heard back within 90 days, contact CDFA_Organic@cdfa.ca.gov. Keep your application confirmation/tracking number.', es: 'El procesamiento generalmente toma 60-120 días. Si no has recibido respuesta dentro de 90 días, contacta CDFA_Organic@cdfa.ca.gov. Conserva tu número de confirmación/seguimiento de solicitud.' },
  },
];

async function streamClaude(messages, assistant, onChunk, onError) {
  try {
    const res = await authedFetch('/api/claude', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...assistant, stream: true }),
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
  } catch (err) { onError(err.message); }
}

function CheckItem({ item, checked, onToggle, lang }) {
  const [expanded, setExpanded] = useState(false);
  const catColors = { Eligibility: '#3AA8E4', Documents: '#FDBD10', Application: '#1B6B2E', 'Follow-up': '#7c3aed' };
  const color = catColors[item.category] || '#64748b';

  return (
    <div style={{ background: 'white', borderRadius: 12, border: `1.5px solid ${checked ? '#bbf7d0' : '#e2e8f0'}`, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 14, cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        <button onClick={e => { e.stopPropagation(); onToggle(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, marginTop: 1 }}>
          {checked ? <CheckCircle2 size={22} color="#22c55e" /> : <Circle size={22} color="#cbd5e1" />}
        </button>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color, padding: '2px 7px', background: `${color}18`, borderRadius: 6 }}>
            {item.category}
          </span>
          <p style={{ fontWeight: checked ? 500 : 700, color: checked ? '#94a3b8' : '#1e293b', fontSize: 14, marginTop: 4, textDecoration: checked ? 'line-through' : 'none' }}>
            {item.title[lang]}
          </p>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>{item.desc[lang]}</p>
        </div>
        {expanded ? <ChevronDown size={18} color="#cbd5e1" /> : <ChevronRight size={18} color="#cbd5e1" />}
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0 18px 16px 54px', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px', marginTop: 10, border: '1px solid #bbf7d0' }}>
                <p style={{ fontSize: 12, color: '#166534', lineHeight: 1.7 }}><strong>Tip:</strong> {item.tip[lang]}</p>
              </div>
              {item.link && (
                <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, fontSize: 12, color: 'var(--u-sky)', fontWeight: 600, textDecoration: 'none' }}>
                  <ExternalLink size={12} /> {item.linkText[lang]}
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function OCCSPAssistant({ profile, userId }) {
  const { lang } = useLanguage();
  const [checked, setChecked] = useState(() => loadFromStorage(STORAGE_KEY, {}));
  const [annualCerts, setAnnualCerts] = useState('');
  const [inspectionFees, setInspectionFees] = useState('');
  const [otherFees, setOtherFees] = useState('');
  const [aiOutput, setAiOutput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiRef = useRef('');

  // Load from Supabase on mount
  useEffect(() => {
    if (!userId) return;
    getProfile(userId).then(profile => {
      if (profile?.occsp_state && Object.keys(profile.occsp_state).length > 0) {
        setChecked(profile.occsp_state);
        saveToStorage(STORAGE_KEY, profile.occsp_state);
      }
    });
  }, [userId]);

  const toggle = (id) => {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    saveToStorage(STORAGE_KEY, next);
    debouncedSync(userId, 'occsp_state', next);
  };

  const completedCount = CHECKLIST_ITEMS.filter(i => checked[i.id]).length;
  const progress = Math.round((completedCount / CHECKLIST_ITEMS.length) * 100);

  const totalCosts = (parseFloat(annualCerts) || 0) + (parseFloat(inspectionFees) || 0) + (parseFloat(otherFees) || 0);
  const maxReimbursement = Math.min(totalCosts * 0.75, 750);

  const calculateWithJimmy = async () => {
    setAiLoading(true);
    setAiOutput('');
    aiRef.current = '';
    const prompt = `A California organic farmer wants to apply for OCCSP reimbursement. Calculate their estimated reimbursement and provide specific application advice.

Operation: ${profile?.operationName || 'California Organic Farm'}
Operation Type: ${profile?.operationType || 'crop production'}
Certifier: ${profile?.certifierName || 'Not specified'}
Annual Certification Fees: $${annualCerts || 0}
Inspection Fees: $${inspectionFees || 0}
Other Eligible Fees: $${otherFees || 0}
Total Eligible Costs: $${totalCosts.toFixed(2)}

Please provide:
1. ESTIMATED REIMBURSEMENT CALCULATION
   - 75% of eligible costs = $${(totalCosts * 0.75).toFixed(2)}
   - Maximum cap: $750 per certification
   - Estimated reimbursement: $${maxReimbursement.toFixed(2)}

2. TIPS FOR THIS SPECIFIC OPERATION (based on type and certifier)
3. COMMON MISTAKES TO AVOID when applying
4. TIMELINE RECOMMENDATION (when to apply based on their certification cycle)
5. IF ELIGIBLE FOR MULTIPLE CERTIFICATIONS (operations can get up to $750 per cert)

Be specific and helpful. Format clearly with headers.${lang === 'es' ? '\n\nRespond entirely in Spanish.' : ''}`;

    await streamClaude(
      [{ role: 'user', content: prompt }],
      { mode: 'occsp', lang },
      (chunk) => { aiRef.current += chunk; setAiOutput(aiRef.current); },
      (err) => setAiOutput(`[Error: ${err}]`)
    );
    setAiLoading(false);
  };

  const categories = [...new Set(CHECKLIST_ITEMS.map(i => i.category))];

  const tx = {
    title: lang === 'es' ? 'Asistente OCCSP' : 'OCCSP Assistant',
    subtitle: lang === 'es'
      ? 'Programa de Participación de Costos de Certificación Orgánica — reembolso de hasta el 75% de tus costos de certificación'
      : 'Organic Certified Cost Share Program — reimburse up to 75% of your certification costs',
    calcTitle: lang === 'es' ? 'Calcular Reembolso con Jimmy' : 'Calculate Reimbursement with Jimmy',
    annualCerts: lang === 'es' ? 'Tarifas Anuales de Certificación ($)' : 'Annual Certification Fees ($)',
    inspectionFees: lang === 'es' ? 'Tarifas de Inspección ($)' : 'Inspection Fees ($)',
    otherFees: lang === 'es' ? 'Otras Tarifas Elegibles ($)' : 'Other Eligible Fees ($)',
    total: lang === 'es' ? 'Total de Costos Elegibles' : 'Total Eligible Costs',
    estimate: lang === 'es' ? 'Reembolso Estimado (75%, máx $750)' : 'Estimated Reimbursement (75%, max $750)',
    calcBtn: lang === 'es' ? 'Analizar con Jimmy' : 'Analyze with Jimmy',
    progress: lang === 'es' ? 'Progreso' : 'Progress',
    checklist: lang === 'es' ? 'Lista de Verificación de Solicitud' : 'Application Checklist',
    download: lang === 'es' ? 'Descargar Resumen' : 'Download Summary',
  };

  const downloadSummary = () => {
    const lines = [
      'OCCSP APPLICATION SUMMARY',
      `Operation: ${profile?.operationName || 'N/A'}`,
      `Date: ${new Date().toLocaleDateString()}`,
      '',
      'COST BREAKDOWN',
      `Annual Certification Fees: $${parseFloat(annualCerts || 0).toFixed(2)}`,
      `Inspection Fees: $${parseFloat(inspectionFees || 0).toFixed(2)}`,
      `Other Eligible Fees: $${parseFloat(otherFees || 0).toFixed(2)}`,
      `Total Eligible Costs: $${totalCosts.toFixed(2)}`,
      `Estimated Reimbursement: $${maxReimbursement.toFixed(2)}`,
      '',
      'CHECKLIST COMPLETION',
      ...CHECKLIST_ITEMS.map(i => `${checked[i.id] ? '[X]' : '[ ]'} ${i.title.en}`),
      '',
      'CONTACT',
      'CDFA Organic Program: CDFA_Organic@cdfa.ca.gov',
      'Phone: (916) 900-5201',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'occsp-application-summary.txt';
    a.click();
  };

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--u-navy)', fontFamily: 'Lora, serif', marginBottom: 6 }}>{tx.title}</h1>
          <p style={{ color: '#64748b', fontSize: 14 }}>{tx.subtitle}</p>
        </div>
        <button onClick={downloadSummary} style={{ padding: '9px 16px', borderRadius: 9, border: '1.5px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7, color: '#475569' }}>
          <Download size={14} /> {tx.download}
        </button>
      </div>

      {/* Key info */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: lang === 'es' ? 'Reembolso Máximo' : 'Max Reimbursement', value: '$750', color: '#1B6B2E' },
          { label: lang === 'es' ? 'Porcentaje' : 'Reimbursement Rate', value: '75%', color: '#3AA8E4' },
          { label: lang === 'es' ? 'Por Certificación' : 'Per Certification', value: lang === 'es' ? 'Anual' : 'Annual', color: '#FDBD10' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'white', borderRadius: 12, padding: '16px 20px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <p style={{ fontSize: 28, fontWeight: 800, color }}>{value}</p>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Calculator */}
      <div style={{ background: 'white', borderRadius: 14, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          <DollarSign size={18} /> {tx.calcTitle}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
          {[
            [annualCerts, setAnnualCerts, tx.annualCerts],
            [inspectionFees, setInspectionFees, tx.inspectionFees],
            [otherFees, setOtherFees, tx.otherFees],
          ].map(([val, setter, label]) => (
            <div key={label}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{label}</label>
              <input
                type="number" step="0.01" min="0" value={val}
                onChange={e => setter(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          ))}
        </div>
        {totalCosts > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
            {[[tx.total, `$${totalCosts.toFixed(2)}`, '#475569'], [tx.estimate, `$${maxReimbursement.toFixed(2)}`, '#1B6B2E']].map(([label, value, color]) => (
              <div key={label} style={{ padding: '12px 16px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>{label}</p>
                <p style={{ fontSize: 22, fontWeight: 700, color }}>{value}</p>
              </div>
            ))}
          </div>
        )}
        <button onClick={calculateWithJimmy} disabled={aiLoading} style={{
          padding: '11px 20px', borderRadius: 10, border: 'none', cursor: aiLoading ? 'not-allowed' : 'pointer',
          background: aiLoading ? '#e2e8f0' : 'var(--u-navy)', color: aiLoading ? '#94a3b8' : 'white',
          fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Sparkles size={15} />
          {aiLoading ? (lang === 'es' ? 'Analizando...' : 'Analyzing...') : tx.calcBtn}
        </button>

        {aiOutput && (
          <div style={{ marginTop: 18, padding: 16, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' }}>
            {aiOutput}
            {aiLoading && <span style={{ animation: 'caretBlink 0.8s step-end infinite' }}>▋</span>}
          </div>
        )}
      </div>

      {/* Progress */}
      <div style={{ background: 'white', borderRadius: 12, padding: '14px 18px', border: '1px solid #e2e8f0', marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>{tx.checklist}</span>
          <span style={{ color: '#64748b' }}>{completedCount}/{CHECKLIST_ITEMS.length} {lang === 'es' ? 'completados' : 'completed'}</span>
        </div>
        <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
          <motion.div animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }}
            style={{ height: '100%', background: progress === 100 ? '#22c55e' : 'var(--u-navy)', borderRadius: 4 }} />
        </div>
      </div>

      {/* Checklist */}
      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{cat}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {CHECKLIST_ITEMS.filter(i => i.category === cat).map(item => (
              <CheckItem key={item.id} item={item} checked={!!checked[item.id]} onToggle={() => toggle(item.id)} lang={lang} />
            ))}
          </div>
        </div>
      ))}

      {/* Contact info */}
      <div style={{ background: 'linear-gradient(135deg, var(--u-navy-d), var(--u-navy))', borderRadius: 14, padding: '18px 24px', color: 'white' }}>
        <p style={{ fontWeight: 700, marginBottom: 8 }}>
          {lang === 'es' ? 'Contacto OCCSP de California' : 'California OCCSP Contact'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, opacity: 0.9 }}>
          <p>Email: CDFA_Organic@cdfa.ca.gov</p>
          <p>{lang === 'es' ? 'Teléfono' : 'Phone'}: (916) 900-5201</p>
          <p style={{ gridColumn: '1 / -1' }}>CDFA Organic Program, 1220 N Street, Sacramento, CA 95814</p>
        </div>
        <a href="https://www.cdfa.ca.gov/is/i_&_c/organic.html" target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, fontSize: 12, color: 'var(--u-gold)', fontWeight: 600, textDecoration: 'none' }}>
          <ExternalLink size={12} /> {lang === 'es' ? 'Sitio web del Programa Orgánico CDFA' : 'CDFA Organic Program Website'}
        </a>
      </div>
    </div>
  );
}
