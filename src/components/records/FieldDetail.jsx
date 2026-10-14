import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_META } from '../../domain/records/kinds.js';
import { summarizeRecord } from '../../domain/records/schemas.js';
import { formatNumber } from './format.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import Modal from './Modal.jsx';

/** The most records listed in one field's history (a busy field can have hundreds). */
export const HISTORY_LIMIT = 50;

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0' };
const td = { padding: '8px 10px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' };

function Fact({ label, children }) {
  return (
    <div data-testid="field-fact" style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
      <div style={{ width: 150, flexShrink: 0, color: '#64748b' }}>{label}</div>
      <div style={{ flex: 1, color: '#0f172a', wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

/** One field and what has happened in it, from `summarizeFields` (approved records only). */
export default function FieldDetail({ summary, truncated = false, onClose }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang).fields;
  const { field, uses, crops, lastApplication, lastHarvest, records } = summary;

  const shown = records.slice(0, HISTORY_LIMIT);
  const none = tt.detail.none;

  return (
    <Modal title={field.name} onClose={onClose}>
      {field.area !== null && field.area !== undefined && field.area_unit && (
        <p style={{ margin: '0 0 4px', fontSize: 13, color: '#334155' }}>{`${formatNumber(field.area, lang)} ${tt.units[field.area_unit] ?? ''}`.trim()}</p>
      )}
      {field.notes && <p style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b', whiteSpace: 'pre-wrap' }}>{field.notes}</p>}

      <div style={{ marginTop: 8 }}>
        <Fact label={tt.detail.crops}>{crops.length > 0 ? crops.join(', ') : none}</Fact>
        <Fact label={tt.detail.lastApplication}>{lastApplication ?? none}</Fact>
        <Fact label={tt.detail.lastHarvest}>{lastHarvest ?? none}</Fact>
        <Fact label={tt.detail.recordsLabel}>{tt.detail.records(uses)}</Fact>
      </div>

      {truncated && (
        <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '8px 12px', margin: '12px 0 0' }}>{tt.detail.truncated}</p>
      )}

      <h3 style={{ fontSize: 13, color: '#475569', margin: '18px 0 6px' }}>{tt.detail.history}</h3>
      {shown.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 12 }}>{tt.detail.noHistory}</p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr><th style={th}>{recordsText(lang).table.date}</th><th style={th}>{recordsText(lang).table.kind}</th><th style={th}>{recordsText(lang).table.summary}</th></tr>
              </thead>
              <tbody>
                {shown.map((record) => (
                  <tr key={record.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748b' }}>{record.record_date ?? recordsText(lang).table.noDate}</td>
                    <td style={{ ...td, color: KIND_META[record.kind]?.color }}>{KIND_META[record.kind]?.label[lang] ?? record.kind}</td>
                    <td style={td}>{summarizeRecord(record, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {records.length > HISTORY_LIMIT && <p style={{ color: '#64748b', fontSize: 12, margin: '6px 0 0' }}>{tt.detail.newest(HISTORY_LIMIT)}</p>}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="button" onClick={onClose} style={ui.buttonSecondary}>{tt.detail.close}</button>
      </div>
    </Modal>
  );
}
