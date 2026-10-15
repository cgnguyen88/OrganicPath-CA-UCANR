import { cleanText } from '../../domain/records/csv.js';
import { materialsForPrompt } from '../../domain/records/materials.js';
import { coverageForPrompt } from '../../domain/records/coverage.js';

/**
 * What the AI is asked to write for the two documents that are built from the farm's records. The facts
 * come from the records; the rules below are there because a compliance document with an invented date,
 * product or finding is worse than one with a gap in it.
 */

export const NO_INVENTING_RULES = `RULES:
- Use only the information in this request. Do not invent products, suppliers, dates, quantities, lot numbers, listing numbers, test results or findings.
- Where a detail is not given, write "Not recorded" and list it as a gap to fix.
- A material is OMRI listed only if its status above says "listed". Treat every other status as "needs verification".
- Do not state that the operation is compliant. Report what the records show and what still needs checking.`;

const MAX_TYPED = 2000;
const SPANISH = '\n\nRespond entirely in Spanish.';

/** Text the farm typed in, on one line and no longer than a few paragraphs, so it cannot read as an instruction. */
const typed = (value, fallback) => cleanText(value).replace(/\s+/g, ' ').trim().slice(0, MAX_TYPED) || fallback;

const applicationsText = ({ sprays, amendments, first, last }) =>
  sprays + amendments > 0 ? `spray records: ${sprays}, amendment records: ${amendments}, dated ${first} to ${last}` : 'No spray or amendment records in this period.';

/**
 * @param {{
 *   operationName: string, auditDate: string, months: number, from: string,
 *   materials: ReturnType<typeof import('../../domain/records/materials.js').summarizeMaterials>,
 *   summary: ReturnType<typeof import('../../domain/records/materials.js').applicationSummary>,
 *   typedInputs: string, storage: string, nonCompliances: string, lang: 'en' | 'es',
 * }} input
 */
export function substanceAuditPrompt({ operationName, auditDate, months, from, materials, summary, typedInputs, storage, nonCompliances, lang }) {
  return `Generate a comprehensive Prohibited Substance Audit Report for a California certified organic operation.

Operation: ${typed(operationName, 'not provided')}
Audit Date: ${typed(auditDate, 'not provided')}
Audit Period Covered: last ${Math.round(months)} months (${from} to ${auditDate})

MATERIALS FROM THE FARM'S OWN RECORDS ("not recorded" means the farm has not recorded it):
${materialsForPrompt(materials) || 'No materials are recorded in the farm records for this period.'}

Application records in the farm's system: ${applicationsText(summary)}
Additional inputs typed in by the farm: ${typed(typedInputs, 'none')}
Storage locations: ${typed(storage, 'not provided')}
Known non-compliance incidents: ${typed(nonCompliances, 'none reported by the farm')}

${NO_INVENTING_RULES}

Write a complete audit report with these sections, each under its own ## heading (keep the numbers):
1. Audit Header & Scope
2. Methodology (review process, documents examined)
3. Input Inventory Review Table (a Markdown table with, for each input: product name, OMRI status as recorded, NOP classification, compliance status: only what the records support)
4. Prohibited Substance Screening Checklist
   - Synthetic fertilizers (prohibited under NOP §205.601)
   - Prohibited pesticides/herbicides
   - Prohibited materials on livestock operations
   - GMO/excluded methods check
5. Storage & Handling Review (commingling risk, contamination prevention)
6. Supplier Verification Status
7. Application Records Compliance (required buffer periods, pre-harvest intervals)
8. Findings Summary (for each category: what the records show, and what is still unverified)
9. Corrective Actions Required (every gap named above)
10. Auditor Certification (a blank signature block)

Be specific about NOP regulations. Flag any questionable materials.${lang === 'es' ? SPANISH : ''}`;
}

/**
 * @param {{
 *   operationName: string, certificationYear: number | string, operationType: string, certifier: string, certNumber: string,
 *   products: string, systemDescription: string, coverage: ReturnType<typeof import('../../domain/records/coverage.js').summarizeCoverage>,
 *   lang: 'en' | 'es',
 * }} input
 */
export function auditTrailPrompt({ operationName, certificationYear, operationType, certifier, certNumber, products, systemDescription, coverage, lang }) {
  const span = `${coverage.years[0]}–${coverage.years[coverage.years.length - 1]}`;
  return `Generate a comprehensive 5-Year Organic Audit Trail Recordkeeping System for a California certified organic operation.

Operation Details:
- Operation Name: ${typed(operationName, 'not provided')}
- Certification Year: ${typed(String(certificationYear), 'not provided')}
- Operation Type: ${typed(operationType, 'not provided')}
- Certifying Agent: ${typed(certifier, 'not provided')}
- Certificate Number: ${typed(certNumber, 'not provided')}
- Products Certified: ${typed(products, 'not provided')}
- Recordkeeping System Description: ${typed(systemDescription, 'not provided')}

WHAT THE FARM'S RECORDS ACTUALLY HOLD (approved records, ${span}):
${coverageForPrompt(coverage, 'en')}

${NO_INVENTING_RULES}

Write a complete 5-Year Audit Trail System with these sections, each under its own ## heading (keep the numbers):

1. System Overview & Regulatory Basis
   - Reference to NOP §205.103 (recordkeeping requirements)
   - 5-year retention mandate
   - Audit trail definition and purpose

2. Master Record Index (a Markdown table of the record categories, showing what the records above hold and what is missing)

3. Annual Recordkeeping Calendar (month-by-month checklist)

4. Required Record Categories (what each must contain):
   a) Field Activity Log (planting, harvesting, field operations)
   b) Input Purchase Records (supplier, lot #, OMRI status, quantity)
   c) Input Application Records (field, date, rate, applicator)
   d) Sales/Lot Tracking Records (buyer, quantity, organic certification disclosure)
   e) Pest Management Activity Log
   f) Water/Irrigation Records (if applicable)
   g) Supplier Verification File
   h) Annual Update Submission Log

5. Commingling Prevention Records (NOP §205.272)
   - Separation documentation
   - Parallel production records (if applicable)

6. Inspection Readiness Checklist (what to have ready for annual inspection)

7. Electronic Records Policy (backup, security, access)

8. Record Retention Schedule (5-year rolling calendar)

9. System Certification Statement (a blank signature block)

Make it practical, and name every gap the records above show.${lang === 'es' ? SPANISH : ''}`;
}
