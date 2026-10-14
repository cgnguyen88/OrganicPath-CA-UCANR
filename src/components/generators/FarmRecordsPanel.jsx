import { applicationSummary, needsOmriAttention } from '../../domain/records/materials.js';
import { suppliersOf } from '../../domain/records/materials.js';
import { logRoute } from '../../lib/recordsRoute.js';
import { generatorsText } from './text.js';

const MAX_SHOWN = 12;
const box = { padding: '14px 16px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0' };
const outlined = { background: 'white', border: '1.5px solid #e2e8f0', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--u-navy)' };

const statusOf = (material, tt) => (material.statusConflict ? tt.records.omri.conflict : tt.records.omri[material.omriStatus]);

/**
 * What a document is being written from: the farm's own materials, their suppliers and how many
 * applications there are. Shown above the form so the person sees exactly which facts the AI is given.
 *
 * @param {{ lang: 'en' | 'es', status: 'loading' | 'ready' | 'error', materials: object[], records: object[], truncated: boolean, reload: () => void, onNavigate: (page: string) => void }} props
 */
export default function FarmRecordsPanel({ lang, status, materials, records, truncated, reload, onNavigate }) {
  const tt = generatorsText(lang);
  const labels = tt.records;

  if (status === 'loading') return <section aria-label={labels.title} style={box}><p role="status" style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{labels.loading}</p></section>;

  if (status === 'error') {
    return (
      <section aria-label={labels.title} style={{ ...box, background: '#fef2f2', borderColor: '#fecaca' }}>
        <p role="alert" style={{ margin: '0 0 8px', fontSize: 13, color: '#b91c1c' }}>{labels.error}</p>
        <button type="button" onClick={reload} style={outlined}>{labels.retry}</button>
      </section>
    );
  }

  const summary = applicationSummary(records);
  const attention = materials.filter(needsOmriAttention).length;
  const suppliers = suppliersOf(materials);

  return (
    <section aria-label={labels.title} style={box}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#166534' }}>{labels.title}</h4>
      {truncated && <p role="alert" style={{ margin: '0 0 8px', fontSize: 12, color: '#92400e' }}>{labels.truncated}</p>}

      {materials.length === 0 ? (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#334155' }}>{labels.noMaterials}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => onNavigate(logRoute('input'))} style={outlined}>{labels.openInputs}</button>
            <button type="button" onClick={() => onNavigate(logRoute('purchase'))} style={outlined}>{labels.openPurchases}</button>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: '#334155' }}>
            <strong>{labels.materialCount(materials.length)}</strong>
            {attention > 0 && <span style={{ marginLeft: 8, color: '#c2410c' }}>{labels.attention(attention)}</span>}
          </p>
          <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {materials.slice(0, MAX_SHOWN).map((m) => (
              <li key={m.key} style={{ fontSize: 12, padding: '3px 9px', borderRadius: 14, background: 'white', border: `1px solid ${needsOmriAttention(m) ? '#fdba74' : '#e2e8f0'}`, color: '#334155' }}>
                <strong>{m.name}</strong> <span style={{ color: needsOmriAttention(m) ? '#c2410c' : '#64748b' }}>{statusOf(m, tt)}</span>
              </li>
            ))}
            {materials.length > MAX_SHOWN && <li style={{ fontSize: 12, color: '#64748b', padding: '3px 4px' }}>{labels.more(materials.length - MAX_SHOWN)}</li>}
          </ul>
        </>
      )}

      <p style={{ margin: '0 0 4px', fontSize: 12, color: '#475569' }}>{`${labels.suppliers}: ${suppliers.join(', ') || labels.noSuppliers}`}</p>
      <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
        {summary.sprays + summary.amendments > 0 ? labels.applications(summary.sprays, summary.amendments, summary.first, summary.last) : labels.noApplications}
      </p>
    </section>
  );
}
