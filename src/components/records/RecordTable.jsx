import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_META } from '../../domain/records/kinds.js';
import { summarizeRecord } from '../../domain/records/schemas.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import StatusBadge from './StatusBadge.jsx';

const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0' };
const td = { padding: '10px 14px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };

/**
 * A list of records. `showKind` adds the record type (for views that mix kinds). On a phone each row becomes a card
 * (`stack-table` in global.js), labelled from each cell's `data-label`; the summary is the card's title.
 */
export default function RecordTable({ records, showKind = false, onSelect }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);

  if (records.length === 0) {
    return <div style={{ ...ui.card, textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>{tt.table.empty}</div>;
  }

  return (
    <div style={{ ...ui.card, overflowX: 'auto' }}>
      <table className="stack-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>{tt.table.date}</th>
            {showKind && <th style={th}>{tt.table.kind}</th>}
            <th style={th}>{tt.table.summary}</th>
            <th style={th}>{tt.table.status}</th>
            <th style={th}>{tt.table.source}</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} onClick={() => onSelect?.(record)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              <td data-label={tt.table.date} style={{ ...td, whiteSpace: 'nowrap', color: '#64748b' }}>{record.record_date ?? tt.table.noDate}</td>
              {showKind && <td data-label={tt.table.kind} style={{ ...td, color: KIND_META[record.kind]?.color }}>{KIND_META[record.kind]?.label[lang] ?? record.kind}</td>}
              <td className="stack-title" style={td}>
                <button type="button" onClick={(event) => { event.stopPropagation(); onSelect?.(record); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, color: '#0f172a', textAlign: 'left', fontSize: 13 }}>
                  {summarizeRecord(record, lang)}
                </button>
              </td>
              <td data-label={tt.table.status} style={td}><StatusBadge status={record.status} /></td>
              <td data-label={tt.table.source} style={{ ...td, color: '#64748b' }}>{tt.source[record.source] ?? record.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
