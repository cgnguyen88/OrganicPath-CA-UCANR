import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { optionLabel } from '../../domain/records/kinds.js';
import { isLowStock, lowStockRows, summarizeInventory } from '../../domain/records/inventory.js';
import { MATERIAL_KINDS, needsOmriAttention, summarizeMaterials } from '../../domain/records/materials.js';
import { logRoute } from '../../lib/recordsRoute.js';
import { formatNumber } from './format.js';
import { recordsText } from './text.js';
import useFarmRecords from './useFarmRecords.js';
import * as ui from './ui.js';
import RecordForm from './RecordForm.jsx';

/** The records that say what is in stock (the counts) and whether a material is OMRI listed (what was bought, used or kept). */
const STOCK_KINDS = Object.freeze([...MATERIAL_KINDS, 'inventory']);
const NAMES_SHOWN = 5;
const FILTERS = Object.freeze({ all: () => true, low: isLowStock, omri: needsOmriAttention });

const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0' };
const td = { padding: '10px 14px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };
const small = { ...ui.buttonSecondary, padding: '3px 10px', fontSize: 12 };
const STATUS_TONE = { out: ui.TONES.danger, low: ui.TONES.warning, ok: ui.TONES.success, no_level: ui.TONES.muted };
const OMRI_TONE = { listed: ui.TONES.success, not_listed: ui.TONES.danger, unknown: ui.TONES.warning, not_applicable: ui.TONES.neutral };

const badge = (tone) => ({ ...tone, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' });

/**
 * What the farm has in stock now, from its latest approved counts: how much, when to reorder, whether it is
 * OMRI listed. A count is a record like any other (crew submit one, an owner or manager approves it), so
 * "update count" starts a new record from the item's details rather than editing an old one.
 */
export default function StockPage({ farm, role, onNavigate, onChanged }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang).stock;
  const none = tt.none;

  const { status, records, truncated, reload } = useFarmRecords({ farmId: farm.id, kinds: STOCK_KINDS });
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(null); // null, or { prefill } (absent for a new item)
  const [saved, setSaved] = useState(null); // null, or what was saved but is not on this page yet: 'draft' | 'review'

  const rows = useMemo(() => summarizeInventory(records, summarizeMaterials(records)), [records]);
  const low = useMemo(() => lowStockRows(rows), [rows]);
  const shown = rows.filter(FILTERS[filter]);

  function onSaved(record) {
    setForm(null);
    onChanged?.();
    if (record?.status === 'approved') reload();
    else setSaved(record?.status === 'draft' ? 'draft' : 'review');
  }

  const open = (next) => {
    setSaved(null);
    setForm(next);
  };

  return (
    <div style={ui.page}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: '1 1 320px' }}>
          <h1 style={ui.h1}>{tt.title}</h1>
          <p style={{ ...ui.subtitle, margin: 0 }}>{tt.subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onNavigate?.(logRoute('inventory'))} style={ui.buttonSecondary}>{tt.allCounts}</button>
          <button type="button" onClick={() => open({})} style={ui.buttonPrimary}><Plus size={15} aria-hidden="true" />{tt.addItem}</button>
        </div>
      </div>

      {status === 'error' && (
        <div role="alert" style={{ margin: '0 0 14px', padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>{tt.loadError}</span>
          <button type="button" onClick={reload} style={small}>{tt.retry}</button>
        </div>
      )}
      {saved && <p role="status" style={{ fontSize: 13, color: '#166534', background: '#dcfce7', borderRadius: 8, padding: '8px 12px', margin: '0 0 14px' }}>{saved === 'draft' ? tt.savedDraft : tt.savedForReview}</p>}
      {truncated && <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '8px 12px', margin: '0 0 14px' }}>{tt.truncated}</p>}

      {low.length > 0 && (
        <div style={{ ...ui.card, padding: '14px 16px', margin: '0 0 16px', background: '#fffbeb', borderColor: '#fde68a' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#92400e' }}>{tt.low.title(low.length)}</div>
          <p style={{ fontSize: 13, color: '#334155', margin: '4px 0 0', wordBreak: 'break-word' }}>
            {low.slice(0, NAMES_SHOWN).map((row) => row.item).join(', ')}{low.length > NAMES_SHOWN ? tt.low.more(low.length - NAMES_SHOWN) : ''}
          </p>
        </div>
      )}

      {status === 'loading' && <div style={{ ...ui.card, padding: 32, textAlign: 'center', color: '#94a3b8' }}>{tt.loading}</div>}
      {status === 'ready' && rows.length === 0 && <div style={{ ...ui.card, padding: '36px 24px', textAlign: 'center', color: '#64748b' }}>{tt.empty}</div>}

      {rows.length > 0 && (
        <>
          <div role="group" aria-label={tt.filters.label} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.keys(FILTERS).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                style={{ ...small, ...(filter === id ? { background: 'var(--u-navy)', color: 'white', borderColor: 'var(--u-navy)' } : {}) }}
              >
                {tt.filters[id]}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div style={{ ...ui.card, padding: 28, textAlign: 'center', color: '#94a3b8' }}>{tt.noMatch}</div>
          ) : (
            <div style={{ ...ui.card, overflowX: 'auto' }}>
              <table className="stack-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['item', 'onHand', 'reorderAt', 'status', 'omri', 'location', 'lastCounted', 'actions'].map((column) => <th key={column} style={th}>{tt.columns[column]}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.key}>
                      <td className="stack-title" style={{ ...td, fontWeight: 600, color: '#0f172a' }}>{row.item}</td>
                      <td data-label={tt.columns.onHand} style={{ ...td, whiteSpace: 'nowrap' }}>{`${formatNumber(row.quantity, lang)} ${row.unit}`.trim()}</td>
                      <td data-label={tt.columns.reorderAt} style={td}>{row.reorderLevel === null ? none : formatNumber(row.reorderLevel, lang)}</td>
                      <td data-label={tt.columns.status} style={td}><span style={badge(STATUS_TONE[row.status])}>{tt.status[row.status]}</span></td>
                      <td data-label={tt.columns.omri} style={td}>
                        <span style={badge(OMRI_TONE[row.omriStatus])}>{optionLabel('inventory', 'omri_status', row.omriStatus, lang)}</span>
                        {row.omriSource === 'records' && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{tt.omriFromRecords}</div>}
                      </td>
                      <td data-label={tt.columns.location} style={td}>{row.location || none}</td>
                      <td data-label={tt.columns.lastCounted} style={{ ...td, whiteSpace: 'nowrap' }}>{row.lastCounted ?? none}</td>
                      <td className="stack-actions" style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button type="button" aria-label={tt.updateLabel(row.item, row.unit)} onClick={() => open({ prefill: row.startingValues })} style={small}>{tt.updateCount}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '10px 0 0' }}>{tt.pendingNote}</p>
        </>
      )}

      {form && <RecordForm kind="inventory" role={role} farmId={farm.id} prefill={form.prefill} onSaved={onSaved} onCancel={() => setForm(null)} />}
    </div>
  );
}
