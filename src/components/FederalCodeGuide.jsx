import { useState } from 'react';
import { BookOpen, Search, ChevronDown, ChevronRight, ExternalLink, Scale } from 'lucide-react';

// ─── Data ────────────────────────────────────────────────────────────────────

const SUBPARTS = [
  {
    id: 'A',
    label: 'Subpart A — Definitions',
    color: '#4f46e5',
    sections: ['§205.2'],
    summary: 'Defines every technical term used throughout the NOP regulations. Understanding these definitions is essential — certifiers and inspectors rely on exact statutory meanings.',
  },
  {
    id: 'B',
    label: 'Subpart B — Applicability',
    color: '#0284c7',
    sections: ['§205.100', '§205.101', '§205.102'],
    summary: 'Establishes who must comply with the NOP, what operations are covered, and the $5,000 annual gross sales exemption threshold.',
  },
  {
    id: 'C',
    label: 'Subpart C — Production & Handling Requirements',
    color: '#059669',
    sections: ['§205.200–208', '§205.236–241', '§205.270–272'],
    summary: 'The core practice standards — covers crop production, soil management, seeds, crop rotation, pest management, livestock, and handling.',
  },
  {
    id: 'D',
    label: 'Subpart D — Labels & Labeling',
    color: '#d97706',
    sections: ['§205.300–311'],
    summary: 'Rules for using the word "organic" on labels — the four labeling categories, USDA seal usage, and prohibited label claims.',
  },
  {
    id: 'E',
    label: 'Subpart E — Certification',
    color: '#dc2626',
    sections: ['§205.400–411'],
    summary: 'The certification process — application, inspection, granting, continuation, suspension, revocation, and appeals.',
  },
  {
    id: 'F',
    label: 'Subpart F — Accreditation of Certifiers',
    color: '#7c3aed',
    sections: ['§205.500–511'],
    summary: 'Standards that certifying agents (CCOF, MOCA, QAI, etc.) must meet to be accredited by the USDA to certify operations.',
  },
  {
    id: 'G',
    label: 'Subpart G — National List',
    color: '#b45309',
    sections: ['§205.600–606'],
    summary: 'The allowed and prohibited substances list — what inputs can and cannot be used in organic crop, livestock, and handled products.',
  },
];

const SECTIONS = [
  // Subpart A
  {
    id: '205.2',
    subpart: 'A',
    cite: '§205.2',
    title: 'Terms Defined',
    plain: 'The master dictionary of NOP terminology. Every bolded term used in Part 205 is precisely defined here. When a certifier cites a regulation, these definitions control what the words mean.',
    keyTerms: [],
  },

  // Subpart B
  {
    id: '205.100',
    subpart: 'B',
    cite: '§205.100',
    title: 'Who Must Be Certified',
    plain: 'Any operation that produces or handles agricultural products and wants to sell, label, or represent them as organic must be certified — UNLESS gross organic sales are $5,000 or less per year.',
    keyTerms: ['$5,000 exemption', 'certified operation'],
  },
  {
    id: '205.101',
    subpart: 'B',
    cite: '§205.101',
    title: 'Exemptions & Exclusions from Certification',
    plain: 'Operations exempt from certification (under $5,000 sales) still must not use prohibited substances and cannot label products as USDA Organic. Retail food establishments that handle but do not process organic products are also excluded.',
    keyTerms: ['exempt operation', 'retail exclusion'],
  },
  {
    id: '205.102',
    subpart: 'B',
    cite: '§205.102',
    title: 'Use of the Term "Organic"',
    plain: 'Only certified operations may label or represent agricultural products as organic. Misuse of the term can result in civil penalties up to $20,706 per violation.',
    keyTerms: ['civil penalty', 'misrepresentation'],
  },

  // Subpart C — Crops
  {
    id: '205.200',
    subpart: 'C',
    cite: '§205.200',
    title: 'General — Crop & Handling Standards',
    plain: 'Sets the overarching requirement: organic producers must use methods that maintain or improve the natural resources of the operation, including soil and water quality.',
    keyTerms: [],
  },
  {
    id: '205.201',
    subpart: 'C',
    cite: '§205.201',
    title: 'Organic System Plan (OSP)',
    plain: 'Every certified operation must have a written OSP describing all practices and substances used, monitoring activities, and recordkeeping. The OSP is the central document your certifier evaluates.',
    keyTerms: ['OSP', 'operation plan', 'monitoring'],
  },
  {
    id: '205.202',
    subpart: 'C',
    cite: '§205.202',
    title: 'Land Requirements (3-Year Transition)',
    plain: 'Land used to grow organic crops must have had no prohibited substances applied for 36 months preceding the first organic harvest. This is the "3-year transition" rule.',
    keyTerms: ['36-month transition', 'field history', 'prohibited substance'],
  },
  {
    id: '205.203',
    subpart: 'C',
    cite: '§205.203',
    title: 'Soil Fertility & Crop Nutrient Management',
    plain: 'Soil must be managed through tillage, cultivation, and biological practices. Raw manure must be incorporated at least 120 days before harvest of crops whose edible parts contact soil, or 90 days for all others.',
    keyTerms: ['raw manure', '120-day rule', '90-day rule', 'soil management'],
  },
  {
    id: '205.204',
    subpart: 'C',
    cite: '§205.204',
    title: 'Seeds & Planting Stock',
    plain: 'Certified organic seed must be used when commercially available. If not commercially available, untreated seed may be used. Treated seed (with prohibited substances) is prohibited.',
    keyTerms: ['organic seed', 'commercially available', 'untreated seed'],
  },
  {
    id: '205.205',
    subpart: 'C',
    cite: '§205.205',
    title: 'Crop Rotation',
    plain: 'Producers must implement a crop rotation plan that maintains or improves soil organic matter, controls pests and weeds, and manages deficient or excess plant nutrients.',
    keyTerms: ['crop rotation', 'soil health'],
  },
  {
    id: '205.206',
    subpart: 'C',
    cite: '§205.206',
    title: 'Crop Pest, Weed & Disease Management',
    plain: 'Management must follow a preference hierarchy: (1) preventive practices first, (2) mechanical/physical controls, (3) biological controls, (4) allowed materials on the National List. Prohibited synthetic pesticides are never permitted.',
    keyTerms: ['IPM hierarchy', 'National List', 'biological control'],
  },
  {
    id: '205.207',
    subpart: 'C',
    cite: '§205.207',
    title: 'Wild Crop Harvesting',
    plain: 'Wild crops can be certified organic if harvested from land that has had no prohibited substances applied for 3 years and harvesting won\'t damage the ecosystem.',
    keyTerms: ['wild crop', 'ecosystem integrity'],
  },
  {
    id: '205.208',
    subpart: 'C',
    cite: '§205.208',
    title: 'Commingling & Contamination Prevention',
    plain: 'Organic crops must be protected from contact with prohibited substances and commingling with non-organic products throughout production, harvest, and transport.',
    keyTerms: ['commingling', 'buffer zones', 'contamination'],
  },

  // Subpart C — Livestock
  {
    id: '205.236',
    subpart: 'C',
    cite: '§205.236',
    title: 'Origin of Livestock',
    plain: 'Livestock must be managed organically from the last third of gestation. Dairy animals must be managed organically for 12 months before their milk can be sold as organic. Poultry must be from the second day of life.',
    keyTerms: ['last third of gestation', '12-month dairy transition', 'poultry'],
  },
  {
    id: '205.237',
    subpart: 'C',
    cite: '§205.237',
    title: 'Livestock Feed',
    plain: 'All livestock must be fed 100% certified organic feed. Synthetic hormones and animal drugs used for growth promotion are prohibited. Pasture must be a significant portion of ruminant diet.',
    keyTerms: ['100% organic feed', 'no hormones', 'pasture requirement'],
  },
  {
    id: '205.238',
    subpart: 'C',
    cite: '§205.238',
    title: 'Livestock Health Care',
    plain: 'Producers must use preventive health care. Sick animals must be treated — if a prohibited substance is needed to save an animal\'s life, the animal must be treated but removed from organic production.',
    keyTerms: ['preventive health', 'prohibited veterinary drugs', 'animal welfare'],
  },
  {
    id: '205.239',
    subpart: 'C',
    cite: '§205.239',
    title: 'Livestock Living Conditions',
    plain: 'All livestock must have year-round access to the outdoors, shade, shelter, exercise areas, fresh air, clean water, and direct sunlight. Indoor confinement for extended periods is prohibited except for limited reasons.',
    keyTerms: ['outdoor access', 'exercise area', 'confinement'],
  },
  {
    id: '205.240',
    subpart: 'C',
    cite: '§205.240',
    title: 'Pasture Practice Standard',
    plain: 'Ruminant livestock must have access to pasture throughout the grazing season, which must be at least 120 days per year. Pasture must provide at least 30% of dry matter intake on average over the grazing season.',
    keyTerms: ['120-day grazing', '30% dry matter', 'ruminant'],
  },
  {
    id: '205.241',
    subpart: 'C',
    cite: '§205.241',
    title: 'Access to Pasture for Dairy',
    plain: 'Specifically requires dairy ruminants to graze on certified organic pasture for a minimum 120-day grazing season, obtaining at least 30% of their dry matter intake from pasture during that period.',
    keyTerms: ['dairy pasture', 'dry matter intake'],
  },

  // Subpart C — Handling
  {
    id: '205.270',
    subpart: 'C',
    cite: '§205.270',
    title: 'Handling Practice Standard',
    plain: 'Certified handlers must maintain the organic integrity of products using allowed substances only, prevent contamination, and protect organic products from commingling with non-organic products.',
    keyTerms: ['organic integrity', 'handling'],
  },
  {
    id: '205.271',
    subpart: 'C',
    cite: '§205.271',
    title: 'Facility Pest Management',
    plain: 'Pest management in handling facilities must use a preference hierarchy: prevention first, then mechanical/physical controls, then allowed materials. Fumigants on the National List may only be used as a last resort.',
    keyTerms: ['facility pest management', 'fumigants'],
  },

  // Subpart D
  {
    id: '205.300',
    subpart: 'D',
    cite: '§205.300',
    title: 'Use of the Term "Organic"',
    plain: 'Only products certified under Part 205 and sold by certified operations may be labeled as "organic." Any operation that fraudulently labels a product as organic is subject to civil penalties.',
    keyTerms: ['organic label', 'civil penalty'],
  },
  {
    id: '205.301',
    subpart: 'D',
    cite: '§205.301',
    title: 'Product Composition — 4 Label Categories',
    plain: '(1) "100% Organic" — all ingredients organic. (2) "Organic" — at least 95% organic ingredients. (3) "Made with Organic [ingredient]" — at least 70% organic. (4) Under 70% organic — may only list specific organic ingredients in the ingredient panel, no "organic" on main display.',
    keyTerms: ['100% organic', '95% organic', '70% organic', 'label tiers'],
  },
  {
    id: '205.303',
    subpart: 'D',
    cite: '§205.303',
    title: 'Packaged Products',
    plain: 'Packaged organic products must display the certifying agent\'s name and address, the organic percentage, and the "USDA Organic" seal (if 95%+ organic). The seal is optional for 100% organic and prohibited for products under 70%.',
    keyTerms: ['USDA seal', 'certifier name on label'],
  },

  // Subpart E
  {
    id: '205.400',
    subpart: 'E',
    cite: '§205.400',
    title: 'General Requirements for Certification',
    plain: 'To receive certification, an operation must: submit an OSP, comply with all NOP regulations, pay fees, allow on-site inspections, and maintain records for 5 years.',
    keyTerms: ['5-year records', 'OSP', 'inspection'],
  },
  {
    id: '205.401',
    subpart: 'E',
    cite: '§205.401',
    title: 'Application for Certification',
    plain: 'An application must include a complete OSP, history of the land (for crops), description of all substances used, and any prior denial or suspension of organic certification.',
    keyTerms: ['application', 'land history', 'prior certification'],
  },
  {
    id: '205.403',
    subpart: 'E',
    cite: '§205.403',
    title: 'On-Site Inspections',
    plain: 'Each certifier must conduct at least one on-site inspection annually. Inspectors review records, observe practices, and may collect samples. Unannounced inspections are also permitted.',
    keyTerms: ['annual inspection', 'unannounced inspection', 'samples'],
  },
  {
    id: '205.405',
    subpart: 'E',
    cite: '§205.405',
    title: 'Continuation of Certification',
    plain: 'Certified operations must annually update and resubmit their OSP reflecting any changes to practices, inputs, fields, or products. Failure to update can result in suspension.',
    keyTerms: ['annual OSP update', 'continuation', 'changes in operation'],
  },
  {
    id: '205.406',
    subpart: 'E',
    cite: '§205.406',
    title: 'Suspension or Revocation of Certification',
    plain: 'Certifiers may suspend or revoke certification for violation of the regulations, use of prohibited substances, false statements, or failure to comply with an adverse action notice. Growers have appeal rights.',
    keyTerms: ['suspension', 'revocation', 'notice of non-compliance', 'appeal'],
  },

  // Subpart G
  {
    id: '205.600',
    subpart: 'G',
    cite: '§205.600',
    title: 'Evaluation Criteria for Allowed/Prohibited Substances',
    plain: 'Establishes how the National Organic Standards Board (NOSB) evaluates whether a substance should be allowed or prohibited. Criteria include compatibility with organic systems, effects on human health and the environment.',
    keyTerms: ['NOSB', 'evaluation criteria', 'allowed substances'],
  },
  {
    id: '205.601',
    subpart: 'G',
    cite: '§205.601',
    title: 'Crop Production — Allowed Synthetic Substances',
    plain: 'Lists synthetic substances allowed for use in organic crop production (e.g., copper-based materials, elemental sulfur, soaps, hydrogen peroxide). All must be used according to label and OSP.',
    keyTerms: ['allowed synthetics', 'copper', 'sulfur', 'OMRI'],
  },
  {
    id: '205.602',
    subpart: 'G',
    cite: '§205.602',
    title: 'Crop Production — Prohibited Nonsynthetic Substances',
    plain: 'Lists naturally-occurring (nonsynthetic) substances that are explicitly prohibited in organic crop production despite being natural — e.g., arsenic, lead salts, strychnine, tobacco dust (nicotine sulfate).',
    keyTerms: ['prohibited naturals', 'arsenic', 'lead', 'nicotine'],
  },
  {
    id: '205.603',
    subpart: 'G',
    cite: '§205.603',
    title: 'Livestock — Allowed Synthetic Substances',
    plain: 'Lists synthetic substances that may be used in organic livestock production — includes vaccines, parasiticides, certain medications, and materials for physical alteration.',
    keyTerms: ['vaccines', 'parasiticides', 'livestock medications'],
  },
  {
    id: '205.604',
    subpart: 'G',
    cite: '§205.604',
    title: 'Livestock — Prohibited Nonsynthetic Substances',
    plain: 'Lists naturally-occurring substances explicitly prohibited in organic livestock production — includes strychnine and other naturally-derived toxicants.',
    keyTerms: ['prohibited livestock inputs'],
  },
  {
    id: '205.605',
    subpart: 'G',
    cite: '§205.605',
    title: 'Handling — Allowed Nonagricultural Substances',
    plain: 'Lists nonagricultural ingredients (e.g., baking soda, calcium carbonate, oxygen, nitrogen) that may be used as processing ingredients in products labeled as "organic" or "made with organic."',
    keyTerms: ['processing aids', 'nonagricultural ingredients'],
  },
  {
    id: '205.606',
    subpart: 'G',
    cite: '§205.606',
    title: 'Handling — Allowed Nonorganic Agricultural Ingredients',
    plain: 'Lists specific agricultural ingredients that may be used as minor components in organic processed products when an organic version is not commercially available (e.g., certain spices, starches, natural flavors).',
    keyTerms: ['nonorganic ingredients', 'commercially unavailable'],
  },
];

const DEFINITIONS = [
  { term: 'Audit Trail', def: 'A series of records of sufficient detail — from purchase or production through sale — so that a certifier or federal agent can trace the origin and quantity of every organic product.' },
  { term: 'Buffer Zone', def: 'An area within or adjacent to an organic operation that acts as a barrier between certified organic land and the nearest land to which prohibited substances are applied. No minimum distance is federally mandated — the certifier determines adequacy.' },
  { term: 'Certifying Agent', def: 'A USDA-accredited private or state entity authorized to certify producers and handlers as meeting NOP standards (e.g., CCOF, MOCA, Oregon Tilth, QAI).' },
  { term: 'Commingling', def: 'The physical contact between organic and non-organic products during production, handling, or transportation in a manner that obscures the identity of the organic product.' },
  { term: 'Handler', def: 'Any person who sells, processes, or packages agricultural products. A person who sells only at roadside stands they operate themselves is not a handler.' },
  { term: 'National List', def: 'The list of approved synthetic substances that may be used (§205.601, §205.603, §205.605) and nonsynthetic substances that are prohibited (§205.602, §205.604) in organic production and handling.' },
  { term: 'Nonsynthetic (Natural)', def: 'A substance derived from mineral, plant, or animal matter and not processed in a manner that fundamentally alters the original physical, chemical, or biological properties.' },
  { term: 'Operator', def: 'A producer, handler, or any person who is seeking certification or is certified under the NOP.' },
  { term: 'Organic System Plan (OSP)', def: 'A plan agreed to by the producer/handler and certifier that describes the practices, substances, and monitoring systems used to comply with the NOP. It is the core document of certification.' },
  { term: 'Prohibited Substance', def: 'A substance whose presence in or on a product is inconsistent with organic production and handling as described in the Act and the NOP regulations.' },
  { term: 'Synthetic', def: 'A substance formulated or manufactured by chemical process or by a process that chemically changes a substance extracted from a naturally occurring plant, animal, or mineral source — except when the resulting product is chemically identical to its naturally-occurring counterpart.' },
  { term: 'Transition Period', def: 'The 36 consecutive months immediately preceding harvest of a crop during which no prohibited substances may be applied to the land. Also called the "3-year transition."' },
  { term: 'Wild Crop', def: 'A plant or portion thereof that is collected or harvested from a site that has received no prohibited substances for a period of 3 years immediately preceding harvest.' },
  { term: 'NOSB', def: 'National Organic Standards Board — a federal advisory committee that makes recommendations to the USDA on the National List and on organic standards. Composed of 15 members representing farmers, handlers, certifiers, scientists, environmentalists, and consumers.' },
  { term: 'OMRI', def: 'Organic Materials Review Institute — a nonprofit that evaluates and lists commercial products suitable for use in organic production. OMRI listing is a common shorthand for NOP compliance, but the certifier — not OMRI — makes the final call.' },
  { term: 'NOP', def: 'National Organic Program — the USDA Agricultural Marketing Service (AMS) program that develops, implements, and administers national production, handling, and labeling standards for organic agricultural products. Located at 7 CFR Part 205.' },
  { term: 'Adverse Action', def: 'A formal action taken by a certifier against a certified operation: a Notice of Non-compliance, Notice of Proposed Suspension or Revocation, or a final Suspension or Revocation of certification.' },
  { term: 'OFPA', def: 'Organic Foods Production Act of 1990 — the federal law (7 U.S.C. §§6501–6523) that authorized USDA to create the NOP. The OFPA is the statutory authority; Part 205 is the implementing regulation.' },
];

// ─── Component ───────────────────────────────────────────────────────────────

function SubpartBadge({ subpart }) {
  const s = SUBPARTS.find(x => x.id === subpart);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      background: s?.color + '20', color: s?.color,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
    }}>
      {s?.label?.split(' — ')[0]}
    </span>
  );
}

function SectionCard({ section, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const color = SUBPARTS.find(s => s.id === section.subpart)?.color || '#374151';

  return (
    <div style={{
      border: '1px solid #e2e8f0', borderRadius: 10,
      overflow: 'hidden', marginBottom: 8,
      borderLeft: `3px solid ${color}`,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', background: open ? '#fafbff' : 'white',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 68, fontFamily: 'monospace' }}>
          {section.cite}
        </span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
          {section.title}
        </span>
        {open ? <ChevronDown size={15} color="#94a3b8" /> : <ChevronRight size={15} color="#94a3b8" />}
      </button>
      {open && (
        <div style={{ padding: '4px 16px 14px 16px', background: '#fafbff', borderTop: '1px solid #f1f5f9' }}>
          <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: section.keyTerms?.length ? 10 : 0 }}>
            {section.plain}
          </p>
          {section.keyTerms?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {section.keyTerms.map(k => (
                <span key={k} style={{
                  padding: '2px 9px', borderRadius: 10, fontSize: 11,
                  background: color + '15', color, fontWeight: 600, border: `1px solid ${color}30`,
                }}>
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FederalCodeGuide() {
  const [tab, setTab] = useState('subparts');
  const [activeSubpart, setActiveSubpart] = useState('C');
  const [search, setSearch] = useState('');
  const [defSearch, setDefSearch] = useState('');

  const TABS = [
    { id: 'subparts', label: 'By Subpart' },
    { id: 'sections', label: 'All Sections' },
    { id: 'definitions', label: 'Key Terms' },
  ];

  const filteredSections = search.trim()
    ? SECTIONS.filter(s =>
        s.cite.toLowerCase().includes(search.toLowerCase()) ||
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.plain.toLowerCase().includes(search.toLowerCase()) ||
        s.keyTerms?.some(k => k.toLowerCase().includes(search.toLowerCase()))
      )
    : tab === 'subparts'
      ? SECTIONS.filter(s => s.subpart === activeSubpart)
      : SECTIONS;

  const filteredDefs = defSearch.trim()
    ? DEFINITIONS.filter(d =>
        d.term.toLowerCase().includes(defSearch.toLowerCase()) ||
        d.def.toLowerCase().includes(defSearch.toLowerCase())
      )
    : DEFINITIONS;

  return (
    <div style={{ padding: '32px 28px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'linear-gradient(135deg, #1B6B2E, #2d9a4a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Scale size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontFamily: 'Lora, serif', fontSize: 26, color: 'var(--u-navy)', marginBottom: 2 }}>
              Federal Organic Regulations
            </h1>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              7 CFR Part 205 — National Organic Program (NOP) · Plain-English guide
            </p>
          </div>
        </div>

        <div style={{
          padding: '12px 16px', background: '#f0f9ff', borderRadius: 8,
          border: '1px solid #bae6fd', display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <BookOpen size={15} color="#0284c7" style={{ marginTop: 2, flexShrink: 0 }} />
          <p style={{ fontSize: 13, color: '#0369a1', lineHeight: 1.6, margin: 0 }}>
            This guide summarizes the USDA National Organic Program regulations in plain language.
            For official legal text, always refer to the{' '}
            <a href="https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-M/part-205"
              target="_blank" rel="noopener noreferrer"
              style={{ color: '#0284c7', fontWeight: 600 }}>
              eCFR official source
            </a>
            {' '}or consult your certifier. Regulations are subject to change.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-strip" style={{ display: 'flex', gap: 4, marginBottom: 22, borderBottom: '2px solid #e2e8f0' }}>
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => { setTab(tb.id); setSearch(''); }}
            style={{
              padding: '9px 20px', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              background: 'none', fontFamily: 'Inter, sans-serif',
              color: tab === tb.id ? '#1B6B2E' : '#64748b',
              borderBottom: tab === tb.id ? '2px solid #1B6B2E' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* BY SUBPART */}
      {tab === 'subparts' && (
        <div className="code-subparts" style={{ display: 'flex', gap: 20 }}>
          {/* Subpart list */}
          <div className="code-subpart-list" style={{ width: 220, flexShrink: 0 }}>
            {SUBPARTS.map(sp => (
              <button key={sp.id} onClick={() => setActiveSubpart(sp.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px',
                  border: 'none', cursor: 'pointer', borderRadius: 8, marginBottom: 4,
                  background: activeSubpart === sp.id ? sp.color + '18' : 'transparent',
                  borderLeft: `3px solid ${activeSubpart === sp.id ? sp.color : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: sp.color, marginBottom: 2 }}>
                  Subpart {sp.id}
                </div>
                <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                  {sp.label.split(' — ')[1]}
                </div>
              </button>
            ))}
          </div>

          {/* Subpart detail */}
          <div style={{ flex: 1 }}>
            {(() => {
              const sp = SUBPARTS.find(s => s.id === activeSubpart);
              return (
                <>
                  <div style={{
                    padding: '14px 16px', borderRadius: 10, marginBottom: 16,
                    background: sp.color + '10', border: `1px solid ${sp.color}30`,
                  }}>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: sp.color, marginBottom: 6 }}>
                      {sp.label}
                    </h2>
                    <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, margin: 0 }}>
                      {sp.summary}
                    </p>
                    <p style={{ fontSize: 12, color: '#64748b', marginTop: 8, marginBottom: 0 }}>
                      Covers: {sp.sections.join(', ')}
                    </p>
                  </div>
                  {filteredSections.map(s => <SectionCard key={s.id} section={s} />)}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ALL SECTIONS */}
      {tab === 'sections' && (
        <div>
          <div style={{ position: 'relative', marginBottom: 18 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sections, citation numbers, or keywords…"
              style={{
                width: '100%', padding: '10px 12px 10px 36px',
                border: '1.5px solid #e2e8f0', borderRadius: 8,
                fontSize: 14, outline: 'none', fontFamily: 'Inter, sans-serif',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {search && (
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              {filteredSections.length} result{filteredSections.length !== 1 ? 's' : ''} for "{search}"
            </p>
          )}
          {filteredSections.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
              <Search size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p style={{ fontSize: 14 }}>No sections match your search.</p>
            </div>
          )}
          {filteredSections.map(s => (
            <div key={s.id}>
              <div style={{ marginBottom: 4 }}>
                <SubpartBadge subpart={s.subpart} />
              </div>
              <SectionCard section={s} />
            </div>
          ))}
        </div>
      )}

      {/* KEY TERMS / DEFINITIONS */}
      {tab === 'definitions' && (
        <div>
          <div style={{ position: 'relative', marginBottom: 18 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              value={defSearch}
              onChange={e => setDefSearch(e.target.value)}
              placeholder="Search terms and definitions…"
              style={{
                width: '100%', padding: '10px 12px 10px 36px',
                border: '1.5px solid #e2e8f0', borderRadius: 8,
                fontSize: 14, outline: 'none', fontFamily: 'Inter, sans-serif',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            {filteredDefs.length} terms from §205.2 and key NOP concepts — explained in plain English.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            {filteredDefs.map(d => (
              <div key={d.term} style={{
                padding: '14px 16px', background: 'white',
                border: '1px solid #e2e8f0', borderRadius: 10,
                borderLeft: '3px solid #1B6B2E',
              }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: '#1B6B2E', marginBottom: 6 }}>
                  {d.term}
                </p>
                <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, margin: 0 }}>
                  {d.def}
                </p>
              </div>
            ))}
            {filteredDefs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                <p style={{ fontSize: 14 }}>No terms match your search.</p>
              </div>
            )}
          </div>

          <div style={{
            marginTop: 24, padding: '14px 16px', background: '#fefce8',
            borderRadius: 8, border: '1px solid #fde68a',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <ExternalLink size={15} color="#b45309" style={{ marginTop: 2, flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: '#92400e', margin: 0, lineHeight: 1.6 }}>
              Full statutory definitions are in <strong>§205.2</strong>. When in doubt about a legal interpretation,
              consult your certifying agent or the{' '}
              <a href="https://www.ams.usda.gov/about-ams/programs-offices/national-organic-program"
                target="_blank" rel="noopener noreferrer"
                style={{ color: '#b45309', fontWeight: 600 }}>
                USDA AMS NOP
              </a>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
