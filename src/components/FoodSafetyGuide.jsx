import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, BookOpen, Columns, Hash, ChevronDown, Info,
  AlertTriangle, CheckCircle2, XCircle, Leaf, Droplets,
  Users, Truck, Bug, FileText, ExternalLink, Scale,
} from 'lucide-react';

// ── Brand colors ──────────────────────────────────────────────────────────────
const C = {
  nop:  { bg: '#1B6B2E', light: '#f0fdf4', border: '#bbf7d0', text: '#166534', badge: '#dcfce7' },
  fsma: { bg: '#1e40af', light: '#eff6ff', border: '#bfdbfe', text: '#1e3a8a', badge: '#dbeafe' },
  gap:  { bg: '#b45309', light: '#fffbeb', border: '#fde68a', text: '#92400e', badge: '#fef3c7' },
};

// ── Topic sections ─────────────────────────────────────────────────────────────
const TOPICS = [
  {
    id: 'documentation',
    icon: FileText,
    title: 'System Plans & Documentation',
    nop: [
      'Organic System Plan (OSP) required — submitted with application.',
      'OSP documents substance lists, monitoring practices, and commingling barriers.',
      'Records must be retained for 5 years.',
      'If a practice is not documented, it effectively did not happen in an inspector\'s eyes.',
    ],
    fsma: [
      'No formal written plan required — recordkeeping only.',
      'Records required for: worker training, water testing results, and soil amendment applications.',
      'No set retention period specified in PSR (best practice: 2+ years).',
    ],
    gap: [
      'Written Food Safety Plan mandatory — must be in place at least 1 month prior to audit.',
      '81 mandatory checklist items — a single non-compliant mark causes automatic audit failure.',
      'Records must be retained for a minimum of 2 years.',
      'Risk assessments required annually, plus updates before harvest or after any on-farm injury.',
    ],
  },
  {
    id: 'personnel',
    icon: Users,
    title: 'Personnel & Training',
    nop: [
      'No designated food safety officer required.',
      'No formal personnel training mandates.',
    ],
    fsma: [
      'At least one supervisor must complete Produce Safety Alliance (PSA) Grower Training.',
      'Training must be available in languages workers can understand.',
      'No formal disciplinary policy requirement.',
    ],
    gap: [
      'Must designate a named Food Safety Manager.',
      'Training must be provided in languages all workers understand.',
      'Mandatory written disciplinary policy for food safety violations.',
      'Records of all training sessions must be maintained.',
    ],
  },
  {
    id: 'soil',
    icon: Leaf,
    title: 'Soil Amendments & Composting',
    nop: [
      'Raw manure: 120-day pre-harvest interval for crops touching soil; 90 days for trellised/above-ground crops.',
      'Compost must meet NOP §205.203 time/temperature standards.',
      'Prohibited feedstocks: biosolids, synthetic calcium carbonate, painted/treated wood, mixed municipal waste.',
      'No prohibited substances on land for 3 years prior to first certification.',
    ],
    fsma: [
      'Adopts the NOP 90/120-day raw manure rule.',
      'Records of all amendment applications required.',
      'Certificate of Conformance mandatory for purchased compost to verify microbiological standards were met.',
    ],
    gap: [
      'Adopts NOP 90/120-day raw manure rule.',
      'Static composting: 131°F for 3 consecutive days, then curing.',
      'Windrow composting: 131°F for 15 days (non-consecutive) with ≥5 turnings, then curing.',
      'Curing is complete only when pile temperature equals ambient air temperature.',
      'Certificate of Conformance required for all purchased amendments.',
      'Temperature logs and pathogen/heavy-metal testing (arsenic, cadmium, lead; fecal coliform; Salmonella) required.',
    ],
  },
  {
    id: 'water',
    icon: Droplets,
    title: 'Water Quality',
    nop: [
      'No specific numeric water quality thresholds defined under NOP.',
      'Contamination prevention is a core OSP requirement.',
    ],
    fsma: [
      'Irrigation/production water: <126 generic E. coli (Geometric Mean).',
      'Harvest contact water / handwashing / ice: 0 generic E. coli per 100 mL.',
      '⚠️ FDA is reviewing these numerical standards (as of 2021) — monitor for updates.',
      'One-step-forward / one-step-backward traceability required.',
    ],
    gap: [
      'Potable water (harvest contact): <1 generic E. coli AND <1 total coliform per 100 mL.',
      'Irrigation: industry standards and risk-assessment-based.',
      'Annual water testing required and documented.',
      'All water sources must be mapped in the Food Safety Plan.',
    ],
  },
  {
    id: 'labeling',
    icon: Hash,
    title: 'Labeling Requirements',
    nop: [
      '100% Organic — product may use USDA Organic seal.',
      'Organic (≥95% organic ingredients) — may use USDA seal.',
      'Made with Organic (≥70% organic ingredients) — cannot use USDA seal.',
      '<70% organic — can only list organic ingredients in ingredient panel; no logo.',
    ],
    fsma: [
      '"Qualified Exempt" farms must display farm name and address at point of sale (e.g., on produce boxes).',
      'Produce intended for processing/cooking must be labeled "NOT FOR RAW CONSUMPTION."',
    ],
    gap: [
      'No specific labeling standards beyond traceability lot codes.',
      'Lot codes must link back to field, harvest date, and packing records.',
    ],
  },
  {
    id: 'biosecurity',
    icon: Bug,
    title: 'Animal Management & Biosecurity',
    nop: [
      'Lumber treated with arsenate or other prohibited substances prohibited for new installations contacting soil or livestock.',
      'All inputs must be approved under the National List.',
    ],
    fsma: [
      'Does NOT require destruction of animal habitats or clearing of farm borders (§112.84).',
      'Hedgerows encouraged — research shows they keep wildlife at perimeter and reduce field intrusion.',
      'Domestic animals and pets excluded from production areas.',
      'Visitors prohibited from bringing pets to the farm.',
    ],
    gap: [
      'Domestic animals and pets strictly excluded from all production, packing, and storage areas.',
      'Pets banned from farm during harvest operations — visitors must be informed.',
      'Pest management log required (traps, contractor visits, findings).',
      'Rodent traps: no bait (bait attracts more pests); placed where they cannot contact produce.',
      'Cooler drainage and condensate drip pans required to prevent produce contamination.',
    ],
  },
  {
    id: 'equipment',
    icon: Truck,
    title: 'Equipment & Facilities',
    nop: [
      'Commingling prevention documented in OSP.',
      'Clean-out logs for shared equipment required (§205.272).',
    ],
    fsma: [
      'Equipment must be cleaned and sanitized appropriately.',
      'No mandatory maintenance record requirement.',
    ],
    gap: [
      'Mandatory maintenance records for all vehicles and equipment.',
      'Equipment must not leak oil or chemicals into production areas.',
      'Cooler/cold storage: drip pans required; condensate must not drip onto produce.',
      'Packing shed sanitation SOPs must be documented and followed.',
    ],
  },
];

// ── Comparison rows ────────────────────────────────────────────────────────────
const COMPARISON_ROWS = [
  { topic: 'Legal Basis', nop: 'Voluntary federal certification', fsma: 'Mandatory federal law (FDA enforced)', gap: 'Voluntary — buyer-driven market requirement' },
  { topic: 'Consequence of Failure', nop: 'Loss of organic price premium', fsma: 'Federal prosecution / license to operate loss', gap: 'Market exclusion from wholesalers/retailers' },
  { topic: 'Governing Agency', nop: 'USDA Agricultural Marketing Service', fsma: 'FDA / CDFA (California)', gap: 'USDA AMS; private certifiers (CCOF, SCS, Primus)' },
  { topic: 'Who Must Comply', nop: 'Producers seeking organic certification', fsma: 'Most "covered" farms (see exemptions)', gap: 'Farms supplying buyers who require it' },
  { topic: 'Plan Required?', nop: 'Yes — Organic System Plan (OSP)', fsma: 'No — recordkeeping only', gap: 'Yes — Food Safety Plan (1 month before audit)' },
  { topic: 'Inspection Trigger', nop: 'Producer requests; annual schedule', fsma: 'Random — CDFA contacts you', gap: 'Producer requests; tied to active harvest' },
  { topic: 'Record Retention', nop: '5 years', fsma: 'Not specified (best practice: 2+ years)', gap: '2-year minimum' },
  { topic: 'Fee Structure', nop: '~$300 application + hourly inspection; up to $750 OCCSP reimbursement', fsma: 'No charge in California (as of 2024)', gap: '$115/hr — charged even if audit fails' },
  { topic: 'Raw Manure Rule', nop: '90 / 120 day pre-harvest interval', fsma: 'Follows NOP 90 / 120 day rule', gap: 'Follows NOP 90 / 120 day + compost curing standards' },
  { topic: 'Water Testing', nop: 'No numeric threshold', fsma: '<126 E. coli (irrigation); 0 E. coli (harvest contact)', gap: '<1 E. coli AND <1 coliform (harvest contact)' },
  { topic: 'Training Mandate', nop: 'None', fsma: 'One supervisor must complete PSA training', gap: 'All personnel + Food Safety Manager; multilingual' },
  { topic: 'Inspection Scope', nop: 'Active harvest season preferred', fsma: 'Any time', gap: 'Harvest/washing in progress required' },
];

// ── Key numbers ────────────────────────────────────────────────────────────────
const KEY_NUMBERS = [
  { value: '3 years', label: 'Land must be free of prohibited substances before first NOP certification', color: C.nop },
  { value: '5 years', label: 'NOP record retention requirement', color: C.nop },
  { value: '95%', label: 'Organic ingredient threshold to use the USDA Organic seal', color: C.nop },
  { value: '$750', label: 'Maximum OCCSP NOP cost-share reimbursement available', color: C.nop },
  { value: '120 days', label: 'Pre-harvest interval for raw manure on soil-contact crops', color: C.fsma },
  { value: '90 days', label: 'Pre-harvest interval for raw manure on trellised/above-ground crops', color: C.fsma },
  { value: '126 CFU', label: 'FSMA maximum generic E. coli (Geometric Mean) for irrigation water', color: C.fsma },
  { value: '0 CFU', label: 'FSMA maximum E. coli per 100 mL for harvest-contact water', color: C.fsma },
  { value: '81 items', label: 'Mandatory checklist items in USDA Harmonized GAP Audit', color: C.gap },
  { value: '$115/hr', label: 'USDA Harmonized GAP audit rate — charged whether farm passes or fails', color: C.gap },
  { value: '1 month', label: 'Minimum time Food Safety Plan must be in place before GAP audit', color: C.gap },
  { value: '131–170°F', label: 'Required compost temperature range under NOP §205.203 and GAP', color: C.gap },
  { value: '15 days', label: 'Windrow composting: minimum days at 131–170°F (with ≥5 turnings)', color: C.gap },
  { value: '3 days', label: 'Static/in-vessel composting: minimum days at 131–170°F', color: C.gap },
  { value: '2 years', label: 'GAP and FSMA record retention minimum', color: C.gap },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function FrameworkBadge({ type, size = 'md' }) {
  const labels = { nop: 'NOP', fsma: 'FSMA', gap: 'GAP' };
  const pad = size === 'sm' ? '2px 7px' : '4px 10px';
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{ background: C[type].badge, color: C[type].text, padding: pad, borderRadius: 20, fontSize: fs, fontWeight: 700, flexShrink: 0 }}>
      {labels[type]}
    </span>
  );
}

function TopicCard({ topic, isOpen, onToggle }) {
  const Icon = topic.icon;
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 12 }}>
      <button
        onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={18} color="#475569" />
          </div>
          <span style={{ fontFamily: 'Lora, serif', fontSize: 16, fontWeight: 600, color: 'var(--u-navy)' }}>{topic.title}</span>
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
            <div style={{ padding: '0 24px 24px', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 20 }}>
                {[
                  { type: 'nop', label: 'NOP — Organic', items: topic.nop },
                  { type: 'fsma', label: 'FSMA / PSR', items: topic.fsma },
                  { type: 'gap', label: '3rd Party GAP', items: topic.gap },
                ].map(col => (
                  <div key={col.type} style={{ background: C[col.type].light, borderRadius: 10, padding: 16, border: `1px solid ${C[col.type].border}` }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: C[col.type].text, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{col.label}</div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {col.items.map((item, i) => (
                        <li key={i} style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FoodSafetyGuide() {
  const [activeTab, setActiveTab] = useState('overview');
  const [openTopic, setOpenTopic] = useState('documentation');

  const TABS = [
    { id: 'overview',    label: 'Overview',        icon: BookOpen },
    { id: 'topics',      label: 'By Topic',         icon: Leaf },
    { id: 'comparison',  label: 'Side-by-Side',     icon: Columns },
    { id: 'numbers',     label: 'Key Numbers',      icon: Hash },
  ];

  return (
    <div style={{ padding: 40, maxWidth: 1000, margin: '0 auto' }}>

      {/* Page Header */}
      <header style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, background: 'var(--u-navy)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ShieldCheck size={28} color="var(--u-gold)" />
          </div>
          <div>
            <h1 style={{ fontFamily: 'Lora, serif', fontSize: 30, color: 'var(--u-navy)', marginBottom: 4 }}>Food Safety Guide</h1>
            <p style={{ fontSize: 14, color: '#64748b' }}>NOP, FSMA, and 3rd Party GAP — understand what applies to your operation and how to stay compliant.</p>
          </div>
        </div>

        {/* Framework legend */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { type: 'nop', title: 'NOP — National Organic Program', sub: 'Voluntary · USDA · Organic premium' },
            { type: 'fsma', title: 'FSMA Produce Safety Rule', sub: 'Mandatory · FDA / CDFA · License to operate' },
            { type: 'gap', title: '3rd Party GAP Audit', sub: 'Voluntary · Buyer-driven · Market access' },
          ].map(f => (
            <div key={f.type} style={{ background: C[f.type].light, border: `1px solid ${C[f.type].border}`, borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C[f.type].text }}>{f.title}</div>
              <div style={{ fontSize: 11, color: C[f.type].text, opacity: 0.8, marginTop: 2 }}>{f.sub}</div>
            </div>
          ))}
        </div>
      </header>

      {/* Tabs */}
      <div className="tab-strip" style={{ display: 'flex', gap: 4, marginBottom: 32, background: '#f1f5f9', borderRadius: 10, padding: 4 }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: active ? 'white' : 'transparent',
                color: active ? 'var(--u-navy)' : '#64748b',
                fontWeight: active ? 700 : 500, fontSize: 13, fontFamily: 'Inter, sans-serif',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── TAB: Overview ────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div>
          {/* What applies to you */}
          <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 28, marginBottom: 24 }}>
            <h2 style={{ fontFamily: 'Lora, serif', fontSize: 20, color: 'var(--u-navy)', marginBottom: 16 }}>The Strategic Perspective</h2>
            <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.75, marginBottom: 16 }}>
              The regulatory landscape is a matrix of overlapping requirements — not a single "pass/fail" inspection. A strategic producer treats compliance as an investment in market access and capital protection, not a reactive administrative burden.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { type: 'nop', headline: 'Price Premium', body: 'NOP certification enables the organic premium over conventional products. Failure means loss of that premium — not federal prosecution.' },
                { type: 'fsma', headline: 'License to Operate', body: 'FSMA is mandatory law. For covered farms, compliance is non-negotiable. Failure triggers FDA or CDFA enforcement with federal prosecution authority.' },
                { type: 'gap', headline: 'Market Eligibility', body: 'GAP audits are buyer-driven. Without a current audit, many wholesalers and large-scale retailers will not onboard your farm. Fees are charged win or lose.' },
              ].map(card => (
                <div key={card.type} style={{ background: C[card.type].light, borderRadius: 10, padding: 20, border: `1px solid ${C[card.type].border}` }}>
                  <FrameworkBadge type={card.type} />
                  <div style={{ fontFamily: 'Lora, serif', fontSize: 16, fontWeight: 700, color: C[card.type].text, margin: '10px 0 8px' }}>{card.headline}</div>
                  <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{card.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Regulatory timeline table */}
          <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '20px 28px', borderBottom: '1px solid #f1f5f9' }}>
              <h2 style={{ fontFamily: 'Lora, serif', fontSize: 18, color: 'var(--u-navy)' }}>Regulatory Origins & Timeline</h2>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Framework', 'Core Purpose', 'Origin / Key Dates'].map(h => (
                      <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { fw: 'nop', name: 'National Organic Program', purpose: 'Federal regulation defining requirements for certified organic crops and livestock', dates: 'Organic Foods Production Act 1990; marketplace entry October 1993' },
                    { fw: 'fsma', name: 'FSMA Produce Safety Rule', purpose: 'Federal safety regulation covering the supply chain; PSR governs the farm level', dates: 'Signed into law 2011; large farms 2019; smallest farms 2021' },
                    { fw: 'gap', name: '3rd Party GAP Audits', purpose: 'Voluntary Good Agricultural Practices certification required by specific buyers', dates: 'USDA Harmonized GAP started 2011; voluntarily aligned with FSMA PSR in 2018' },
                  ].map((row, i) => (
                    <tr key={row.fw} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fafafa' : 'white' }}>
                      <td style={{ padding: '16px 20px' }}><FrameworkBadge type={row.fw} /></td>
                      <td style={{ padding: '16px 20px', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{row.purpose}</td>
                      <td style={{ padding: '16px 20px', fontSize: 13, color: '#64748b' }}>{row.dates}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Co-management callout */}
          <div style={{ background: 'var(--u-navy)', borderRadius: 14, padding: 28, color: 'white', display: 'flex', gap: 20 }}>
            <div style={{ width: 48, height: 48, background: 'rgba(253,189,16,0.15)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Scale size={24} color="var(--u-gold)" />
            </div>
            <div>
              <h3 style={{ fontFamily: 'Lora, serif', fontSize: 18, color: 'var(--u-gold)', marginBottom: 8 }}>The Co-Management Philosophy</h3>
              <p style={{ fontSize: 14, lineHeight: 1.75, opacity: 0.9 }}>
                Modern compliance requires integrating food safety with environmental stewardship — not treating them as opposing forces. FSMA §112.84 explicitly states it does not require the destruction of animal habitats or farm border clearing. Strategic producers use hedgerows to maximize biodiversity; research shows these keep wildlife at the perimeter and reduce intrusion into production fields, simultaneously supporting organic principles and reducing food safety risk.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: By Topic ────────────────────────────────────────────────────── */}
      {activeTab === 'topics' && (
        <div>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
            Each section shows NOP, FSMA, and GAP requirements side by side for that compliance area.
          </p>
          {TOPICS.map(topic => (
            <TopicCard
              key={topic.id}
              topic={topic}
              isOpen={openTopic === topic.id}
              onToggle={() => setOpenTopic(openTopic === topic.id ? null : topic.id)}
            />
          ))}
        </div>
      )}

      {/* ── TAB: Comparison ──────────────────────────────────────────────────── */}
      {activeTab === 'comparison' && (
        <div>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
            A side-by-side view of how each framework handles the same requirement.
          </p>
          <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '14px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', width: '22%' }}>Requirement</th>
                  {['nop', 'fsma', 'gap'].map(type => (
                    <th key={type} style={{ padding: '14px 20px', textAlign: 'left', width: '26%' }}>
                      <div style={{ display: 'inline-block', background: C[type].badge, color: C[type].text, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                        {{ nop: 'NOP — Organic', fsma: 'FSMA / PSR', gap: '3rd Party GAP' }[type]}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fafafa' : 'white' }}>
                    <td style={{ padding: '14px 20px', fontSize: 12, fontWeight: 700, color: '#374151' }}>{row.topic}</td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{row.nop}</td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{row.fsma}</td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{row.gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* GAP warning */}
          <div style={{ marginTop: 24, background: C.gap.light, border: `1px solid ${C.gap.border}`, borderRadius: 12, padding: 20, display: 'flex', gap: 14 }}>
            <AlertTriangle size={20} color={C.gap.text} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.gap.text, marginBottom: 6 }}>GAP Audit Financial Risk</div>
              <p style={{ fontSize: 13, color: C.gap.text, lineHeight: 1.6 }}>
                The $115/hr USDA Harmonized GAP fee is charged regardless of whether your farm passes or fails. Pre-audit preparation is not optional — it is critical financial risk management. A failed audit means you paid for the audit AND must repeat it.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Key Numbers ─────────────────────────────────────────────────── */}
      {activeTab === 'numbers' && (
        <div>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
            Critical thresholds, timelines, and financial figures to know before every growing season.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {KEY_NUMBERS.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                style={{ background: 'white', borderRadius: 12, border: `1.5px solid ${item.color.border}`, padding: 20 }}
              >
                <div style={{ fontFamily: 'Lora, serif', fontSize: 28, fontWeight: 900, color: item.color.bg, lineHeight: 1, marginBottom: 8 }}>{item.value}</div>
                <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.55 }}>{item.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Compost deep-dive */}
          <div style={{ marginTop: 36, background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ background: C.gap.light, padding: '18px 24px', borderBottom: `1px solid ${C.gap.border}` }}>
              <h3 style={{ fontFamily: 'Lora, serif', fontSize: 18, color: C.gap.text }}>Compost Standards Deep Dive (NOP §205.203 + OMRI)</h3>
            </div>
            <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time / Temperature Requirements</h4>
                {[
                  { method: 'In-vessel / Static Aerated Pile', temp: '131–170°F', time: '3 consecutive days', turns: 'None required' },
                  { method: 'Windrow', temp: '131–170°F', time: '15 days (non-consecutive)', turns: '≥5 turnings' },
                ].map(m => (
                  <div key={m.method} style={{ background: C.gap.light, borderRadius: 8, padding: 14, marginBottom: 10, border: `1px solid ${C.gap.border}` }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.gap.text, marginBottom: 6 }}>{m.method}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[['Temp', m.temp], ['Duration', m.time], ['Turnings', m.turns]].map(([k, v]) => (
                        <div key={k}>
                          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.gap.text, marginTop: 2 }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>Curing Complete When:</div>
                  <div style={{ fontSize: 12, color: '#92400e' }}>Pile temperature equals ambient air temperature.</div>
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Allowed vs. Prohibited Feedstocks</h4>
                <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 14, marginBottom: 10, border: '1px solid #bbf7d0' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#166534', marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <CheckCircle2 size={14} /> Allowed
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
                    {['Plant residues / crop waste', 'Animal manures', 'Food processing waste', 'Unprocessed slaughter byproducts', 'Specific approved synthetics'].map(i => <li key={i}>{i}</li>)}
                  </ul>
                </div>
                <div style={{ background: '#fef2f2', borderRadius: 8, padding: 14, border: '1px solid #fecaca' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#991b1b', marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <XCircle size={14} /> Prohibited
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
                    {['Biosolids (sewage sludge)', 'Painted or treated wood', 'Synthetic calcium carbonate', 'Bioplastics', 'Mixed municipal solid waste', 'Glossy / coated paper'].map(i => <li key={i}>{i}</li>)}
                  </ul>
                </div>

                <div style={{ marginTop: 16, background: C.nop.light, borderRadius: 8, padding: 14, border: `1px solid ${C.nop.border}` }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: C.nop.text, marginBottom: 8 }}>Application Restrictions (NOP §205.203)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 12, color: '#374151' }}><strong>120 days</strong> — pre-harvest for crops with soil contact</div>
                    <div style={{ fontSize: 12, color: '#374151' }}><strong>90 days</strong> — pre-harvest for trellised / above-ground crops</div>
                    <div style={{ fontSize: 12, color: '#374151' }}><strong>No interval</strong> — properly processed compost meeting time/temp</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: '0 24px 24px' }}>
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: 14, border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#475569', marginBottom: 8 }}>Required Documentation (OMRI + GAP)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['Temperature logs (daily readings)', 'Turning frequency records', 'Heavy metals: As, Cd, Pb', 'Fecal coliform testing', 'Salmonella testing', 'Foreign contaminant removal process', 'Certificate of Conformance (purchased compost)'].map(d => (
                    <span key={d} style={{ background: 'white', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: 6, fontSize: 12, color: '#374151' }}>{d}</span>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Info size={13} color="#64748b" />
                <a href="https://www.omri.org/omri-articles/compost-standards" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                  Full OMRI Compost Standards <ExternalLink size={11} />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
