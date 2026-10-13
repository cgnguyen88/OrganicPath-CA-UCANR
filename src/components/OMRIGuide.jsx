import { authedFetch } from '../lib/apiClient.js';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BadgeCheck, BookOpen, Search, AlertTriangle, CheckCircle2,
  XCircle, Info, ExternalLink, ChevronDown, RefreshCw, Leaf,
  FlaskConical, ShieldAlert, HelpCircle,
} from 'lucide-react';

// ── Static content ────────────────────────────────────────────────────────────

const GUIDE_SECTIONS = [
  {
    id: 'what',
    title: 'What is OMRI?',
    icon: BadgeCheck,
    content: [
      'OMRI (Organic Materials Review Institute) is an independent nonprofit organization that reviews input products for compliance with USDA National Organic Program (NOP) standards.',
      'When a product displays the OMRI Listed® seal, OMRI has reviewed its ingredients and manufacturing processes and determined it is allowed for use in certified organic production under the NOP.',
      '⚠️ Important distinction: "OMRI Listed" does NOT mean "certified organic." The OMRI Listed® seal applies to input materials — fertilizers, pesticides, soil amendments — not to the food or fiber your operation produces. Only finished food carries the USDA Organic seal.',
    ],
  },
  {
    id: 'categories',
    title: 'Material Categories OMRI Reviews',
    icon: FlaskConical,
    content: [
      'OMRI reviews three main categories of organic inputs:',
      '🌱 Crops — fertilizers, pest controls, disease controls, soil amendments, mulches, and irrigation aids (sub-codes: CF = Crop Fertilizer, CP = Crop Pest Control, CS = Crop Soil Amendment)',
      '🐄 Livestock — health products, feed additives, sanitizers, housing and bedding materials',
      '🏭 Processing — substances used in certified organic food and fiber processing facilities',
      'Each listed product carries a sub-classification code so growers know exactly which category the approval applies to.',
    ],
  },
  {
    id: 'status',
    title: 'Listing Status: Allowed, Restricted, Prohibited',
    icon: ShieldAlert,
    content: [
      'Every OMRI-reviewed material receives one of three status designations:',
      '✅ Allowed — The material is permitted without additional conditions.',
      '⚠️ Allowed with Restrictions — Permitted only under specific conditions. Common restrictions include: must be applied 90 or 120 days before harvest (raw-contact crops), requires prior certifier approval before first use, or formulation must not contain certain additives.',
      '❌ Prohibited — Contains ingredients not permitted on the NOP National List (§205.601–606). Using a prohibited material can result in loss of organic certification.',
      'Always read the full restriction note — an "Allowed" status without reading the annotations is a common source of non-compliance findings.',
    ],
  },
  {
    id: 'process',
    title: 'How the OMRI Review Process Works',
    icon: Search,
    content: [
      'Manufacturers submit full ingredient lists, formulation details, and manufacturing processes to OMRI for review.',
      'OMRI technical staff evaluates whether all ingredients appear on the NOP National List or are otherwise permitted, and that no manufacturing step introduces prohibited substances.',
      'Listings must be renewed annually. A full compliance review occurs every 3–5 years.',
      'Manufacturers must notify OMRI of any formula change. A product that changes formulation without notice may have its listing suspended or revoked — which means last year\'s listed product may not be listed today.',
      '🔑 Key takeaway for growers: Always verify the current listing status at omri.org before purchase, especially if you haven\'t bought the product recently.',
    ],
  },
  {
    id: 'compost',
    title: 'Compost & Organic Amendment Standards (§205.203)',
    icon: Leaf,
    content: [
      'Compost used in organic production must meet NOP §205.203 time/temperature requirements:',
      '🌡️ In-vessel or static aerated pile: 131–170°F for a minimum of 3 days',
      '🔄 Windrow method: 131–170°F for a minimum of 15 days, with at least 5 turnings',
      'Allowed feedstocks: crop residues, plant matter, animal manure, food scraps from organic sources.',
      'Prohibited feedstocks: plastics, bioplastics, painted or treated wood, biosolids (sewage sludge), prohibited synthetic materials.',
      'Application restrictions: Compost with raw manure components requires 120 days pre-harvest for crops contacting soil, 90 days for others. Properly processed compost meeting time/temp requirements has no application interval restriction.',
      'Required documentation: temperature logs, heavy metal testing (arsenic, cadmium, lead), pathogen testing (fecal coliform, Salmonella), and supplier feedstock disclosure.',
    ],
  },
  {
    id: 'howto',
    title: 'How to Officially Verify OMRI Status',
    icon: ExternalLink,
    content: [
      'The authoritative OMRI Products List is maintained at omri.org/search. To verify a product:',
      '1. Go to omri.org and click "Search the List"',
      '2. Enter the exact product name or manufacturer',
      '3. Filter by category (Crops, Livestock, Processing) and ruling body (U.S. NOP)',
      '4. Review the listing status, any use restrictions, and the listing expiration date',
      'Listings can expire, be suspended, or be revoked. A product listed last year may not be listed today. Always verify directly before purchase or application.',
    ],
    link: { label: 'Search the OMRI Products List', url: 'https://www.omri.org/search' },
  },
];

const COMMON_MISTAKES = [
  {
    severity: 'high',
    title: 'Assuming a brand name = automatic approval',
    desc: 'A product labeled "organic" or "natural" is NOT necessarily NOP-compliant. Product lines often have listed and unlisted variants with nearly identical names. Always check omri.org for the specific product name and formulation.',
  },
  {
    severity: 'high',
    title: 'Using synthetically coated or fungicide-treated seeds',
    desc: 'Most seed coatings — fungicide treatments, polymer coatings, colorants — are prohibited under NOP §205.204. Use only untreated or organically treated seed. Document that organic equivalents were commercially unavailable if you must use untreated conventional seed.',
  },
  {
    severity: 'high',
    title: 'Fish fertilizers containing prohibited preservatives',
    desc: 'Many fish emulsions and fish meals contain formaldehyde, phosphoric acid, or citric acid as preservatives — making them non-compliant even if the base material is allowed. Read the complete ingredient list, not just the N-P-K analysis.',
  },
  {
    severity: 'high',
    title: 'Compost containing prohibited feedstocks',
    desc: 'Compost made with glossy/coated paper, painted wood, bioplastics, or biosolids (sewage sludge) is prohibited. Always request a feedstock disclosure and time/temperature documentation from your compost supplier before every purchase.',
  },
  {
    severity: 'medium',
    title: 'Legume inoculants using GMO bacteria strains',
    desc: 'Some Rhizobium inoculants use genetically engineered bacterial strains. Under NOP §205.105, genetically modified organisms are prohibited. Confirm your inoculant supplier explicitly states "non-GMO" for organic production.',
  },
  {
    severity: 'medium',
    title: 'High-nitrogen liquid fertilizers without certifier approval',
    desc: 'Liquid nitrogen fertilizers with concentrated N (some fish products, blood meal teas) may require prior certifier approval if they could contribute to excess nitrogen. Document application rates, timing, and your agronomic rationale.',
  },
  {
    severity: 'medium',
    title: 'Failing to keep input purchase records and lot numbers',
    desc: 'Even for OMRI-listed products, you must keep purchase receipts, lot numbers, and application logs per §205.103. An inspector may ask to see the actual product container label to confirm the listed formulation — not just a generic product name.',
  },
  {
    severity: 'low',
    title: 'Relying on an expired or outdated OMRI listing',
    desc: 'OMRI listings must be renewed annually. A manufacturer can change a formula without immediate public notice. Verify current status at omri.org before each season, not just when you first start using a product.',
  },
];

const CATEGORIES = [
  { value: '', label: 'Select a category…' },
  { value: 'Crop Fertilizer / Soil Amendment', label: 'Crop Fertilizer / Soil Amendment' },
  { value: 'Crop Pest / Disease Control', label: 'Crop Pest / Disease / Weed Control' },
  { value: 'Compost / Organic Matter', label: 'Compost / Organic Matter' },
  { value: 'Seeds / Planting Stock', label: 'Seeds / Planting Stock' },
  { value: 'Livestock Health / Feed', label: 'Livestock Health / Feed' },
  { value: 'Processing / Handling Aid', label: 'Processing / Handling Aid' },
  { value: 'Other', label: 'Other / Not Sure' },
];

const SEVERITY_COLORS = { high: '#dc2626', medium: '#d97706', low: '#2563eb' };
const SEVERITY_LABELS = { high: 'High Risk', medium: 'Medium Risk', low: 'Important' };

// ── Claude verification ───────────────────────────────────────────────────────

async function verifyWithClaude(material, category, notes) {
  const res = await authedFetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: `A certified organic grower wants to know if the following material is likely OMRI-listed and NOP-compliant.

MATERIAL NAME: ${material}
CATEGORY: ${category || 'Not specified'}
ADDITIONAL CONTEXT: ${notes || 'None provided'}

Provide a structured assessment with these four sections:

LIKELY STATUS: One of exactly — "✅ Likely Allowed", "⚠️ Allowed with Restrictions — verify", "❌ Likely Prohibited", or "❓ Cannot Determine — verify at omri.org"

REASONING: 2–4 sentences explaining your assessment, citing specific NOP sections (§205.601–606, §205.204, §205.203, etc.) as applicable.

KEY CONCERNS: A bulleted list of 2–4 specific things the grower should check — such as prohibited additives, application restrictions, formulation variants, documentation needed, etc.

VERIFICATION STEP: One specific instruction for how to confirm status at omri.org or with their certifier.

Be precise and regulation-specific. If the material name is generic (multiple formulations exist), note that clearly. Do not give false confidence — if uncertain, say so.`,
      }],
      system: `You are an expert on OMRI (Organic Materials Review Institute) listing criteria and USDA NOP National List compliance (7 CFR Part 205). You have comprehensive knowledge of allowed and prohibited substances under §205.601–606, seed requirements under §205.204, and soil/compost requirements under §205.203. Always remind users to verify at omri.org for official confirmation, as your knowledge may not reflect the current OMRI database state.`,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || data.choices?.[0]?.message?.content || '';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GuideSection({ section, isOpen, onToggle }) {
  const Icon = section.icon;
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 12 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: 'rgba(27,107,46,0.08)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={18} color="#1B6B2E" />
          </div>
          <span style={{ fontFamily: 'Lora, serif', fontSize: 16, fontWeight: 600, color: 'var(--u-navy)' }}>{section.title}</span>
        </div>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={18} color="#64748b" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 24px 20px', borderTop: '1px solid #f1f5f9' }}>
              {section.content.map((para, i) => (
                <p key={i} style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginTop: 12 }}>{para}</p>
              ))}
              {section.link && (
                <a
                  href={section.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 16, color: '#1B6B2E', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
                >
                  {section.link.label} <ExternalLink size={13} />
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ text }) {
  const color = text?.includes('✅') ? '#10b981'
    : text?.includes('⚠️') ? '#d97706'
    : text?.includes('❌') ? '#dc2626'
    : '#64748b';
  const bg = text?.includes('✅') ? '#ecfdf5'
    : text?.includes('⚠️') ? '#fffbeb'
    : text?.includes('❌') ? '#fef2f2'
    : '#f8fafc';
  return (
    <div style={{ background: bg, border: `1.5px solid ${color}30`, borderRadius: 10, padding: '12px 18px', marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color }}>{text}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OMRIGuide() {
  const [activeTab, setActiveTab] = useState('guide');
  const [openSection, setOpenSection] = useState('what');

  // Verify form
  const [material, setMaterial] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const handleVerify = async () => {
    if (!material.trim()) return;
    setLoading(true);
    setResult('');
    setError('');
    try {
      const text = await verifyWithClaude(material.trim(), category, notes.trim());
      setResult(text);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const statusLine = result
    ? result.split('\n').find(l =>
        l.includes('✅') || l.includes('⚠️') || l.includes('❌') || l.includes('❓') ||
        l.toLowerCase().includes('likely status')
      )
    : '';

  const TABS = [
    { id: 'guide',    label: 'OMRI Guide',      icon: BookOpen },
    { id: 'verify',   label: 'Verify a Material', icon: Search },
    { id: 'mistakes', label: 'Common Mistakes', icon: AlertTriangle },
  ];

  return (
    <div style={{ padding: 40, maxWidth: 960, margin: '0 auto' }}>

      {/* Page Header */}
      <header style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div style={{ width: 52, height: 52, background: '#1B6B2E', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <BadgeCheck size={28} color="white" />
          </div>
          <div>
            <h1 style={{ fontFamily: 'Lora, serif', fontSize: 30, color: 'var(--u-navy)', marginBottom: 4 }}>OMRI Materials Guide</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>Learn what OMRI-listed means, verify input materials for organic compliance, and avoid common mistakes.</p>
          </div>
        </div>

        {/* Official link banner */}
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#166534' }}>
            <Info size={15} />
            <span>Always verify current listing status at the official OMRI database before applying any new input.</span>
          </div>
          <a
            href="https://www.omri.org/search"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1B6B2E', color: 'white', padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}
          >
            Search OMRI List <ExternalLink size={12} />
          </a>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 32, background: '#f1f5f9', borderRadius: 10, padding: 4 }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: active ? 'white' : 'transparent',
                color: active ? 'var(--u-navy)' : '#64748b',
                fontWeight: active ? 700 : 500, fontSize: 14,
                fontFamily: 'Inter, sans-serif',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── TAB: Guide ───────────────────────────────────────────────────────── */}
      {activeTab === 'guide' && (
        <div>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
            Click any section to expand. Start with "What is OMRI?" if this is your first time.
          </p>
          {GUIDE_SECTIONS.map(section => (
            <GuideSection
              key={section.id}
              section={section}
              isOpen={openSection === section.id}
              onToggle={() => setOpenSection(openSection === section.id ? null : section.id)}
            />
          ))}

          {/* Quick reference card */}
          <div style={{ marginTop: 32, background: 'var(--u-navy)', borderRadius: 16, padding: 28, color: 'white' }}>
            <h3 style={{ fontFamily: 'Lora, serif', fontSize: 18, marginBottom: 20, color: 'var(--u-gold)' }}>Quick Reference: Before You Apply Any Input</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              {[
                { step: '1', text: 'Search omri.org for the exact product name' },
                { step: '2', text: 'Confirm category matches your use (CF, CP, CS…)' },
                { step: '3', text: 'Read all restriction annotations fully' },
                { step: '4', text: 'Check listing expiration date is current' },
                { step: '5', text: 'Get prior certifier approval if required' },
                { step: '6', text: 'Record purchase: receipt, lot#, date, rate' },
              ].map(item => (
                <div key={item.step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, background: 'var(--u-gold)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 900, fontSize: 13, color: 'var(--u-navy)' }}>{item.step}</div>
                  <p style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.9, marginTop: 4 }}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Verify ──────────────────────────────────────────────────────── */}
      {activeTab === 'verify' && (
        <div>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginBottom: 28, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={16} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
              <strong>Jimmy's assessment is educational only.</strong> It is based on NOP training data and may not reflect the current OMRI database. Always confirm at <a href="https://www.omri.org/search" target="_blank" rel="noopener noreferrer" style={{ color: '#92400e', fontWeight: 600 }}>omri.org/search</a> and consult your certifier before applying any new material.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            {/* Left: input form */}
            <div style={{ background: 'white', padding: 28, borderRadius: 14, border: '1.5px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <h3 style={{ fontFamily: 'Lora, serif', fontSize: 18, color: 'var(--u-navy)', marginBottom: 0 }}>Material Details</h3>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                  Product / Material Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={material}
                  onChange={e => setMaterial(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleVerify()}
                  placeholder="e.g. PyGanic EC 5.0, Blood Meal 12-0-0, Copper Sulfate…"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box', fontFamily: 'Inter, sans-serif' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box', fontFamily: 'Inter, sans-serif', background: 'white' }}
                >
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                  Additional Context <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. manufacturer name, how you plan to use it, specific concern…"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'Inter, sans-serif' }}
                />
              </div>

              {error && (
                <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: 13 }}>
                  Error: {error}
                </div>
              )}

              <button
                onClick={handleVerify}
                disabled={loading || !material.trim()}
                style={{
                  background: loading || !material.trim() ? '#94a3b8' : '#1B6B2E',
                  color: 'white', border: 'none', padding: '13px',
                  borderRadius: 8, fontWeight: 700, cursor: loading || !material.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14,
                }}
              >
                {loading
                  ? <><RefreshCw size={17} style={{ animation: 'spin 1s linear infinite' }} /> Checking with Jimmy…</>
                  : <><BadgeCheck size={17} /> Check OMRI Compliance</>
                }
              </button>

              {/* Example queries */}
              <div style={{ paddingTop: 4 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Try an example</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['PyGanic EC 5.0', 'Blood Meal', 'Copper Sulfate', 'Feather Meal', 'Neem Oil'].map(ex => (
                    <button
                      key={ex}
                      onClick={() => setMaterial(ex)}
                      style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', color: '#374151', fontFamily: 'Inter, sans-serif' }}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: result panel */}
            <div style={{ background: '#f8fafc', borderRadius: 14, border: '1.5px solid #e2e8f0', padding: 28, display: 'flex', flexDirection: 'column' }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Jimmy's Assessment</h4>

              {result ? (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {statusLine && <StatusBadge text={statusLine} />}
                  <pre style={{ fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', color: '#1e293b', fontFamily: 'Inter, sans-serif' }}>
                    {result}
                  </pre>
                  <div style={{ marginTop: 20, padding: '12px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <CheckCircle2 size={14} color="#166534" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>Official Verification</span>
                    </div>
                    <a
                      href={`https://www.omri.org/search#stq=${encodeURIComponent(material)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: '#166534', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      Search "{material}" on omri.org <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ) : loading ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#64748b', padding: 40 }}>
                  <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} color="#1B6B2E" />
                  <p style={{ fontSize: 13, textAlign: 'center' }}>Jimmy is cross-referencing your material against NOP National List criteria…</p>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', padding: 40, textAlign: 'center', gap: 16 }}>
                  <BadgeCheck size={40} color="#e2e8f0" />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Enter a material to check</p>
                    <p style={{ fontSize: 13, lineHeight: 1.5 }}>Jimmy will assess NOP compliance and flag any restrictions or concerns.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Common Mistakes ─────────────────────────────────────────────── */}
      {activeTab === 'mistakes' && (
        <div>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
            These are the most frequent NOP non-compliance findings related to organic inputs. Review this list before each growing season.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {COMMON_MISTAKES.map((mistake, idx) => {
              const color = SEVERITY_COLORS[mistake.severity];
              const label = SEVERITY_LABELS[mistake.severity];
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '20px 24px', display: 'flex', gap: 16, alignItems: 'flex-start' }}
                >
                  <div style={{ width: 36, height: 36, background: `${color}12`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <AlertTriangle size={18} color={color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--u-navy)' }}>{mistake.title}</h4>
                      <span style={{ background: `${color}15`, color, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0 }}>{label}</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>{mistake.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Certifier reminder */}
          <div style={{ marginTop: 32, background: 'var(--u-navy)', borderRadius: 14, padding: 28, color: 'white', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <HelpCircle size={28} color="var(--u-gold)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <h3 style={{ fontFamily: 'Lora, serif', fontSize: 18, marginBottom: 8 }}>When in doubt, ask your certifier first</h3>
              <p style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.85 }}>
                Most certifiers offer a pre-approval process for new inputs. Submitting an input for review before use costs you nothing — using a prohibited material and losing your certification costs everything. Keep a running "approved inputs" list that your certifier has signed off on, and update it every season.
              </p>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
