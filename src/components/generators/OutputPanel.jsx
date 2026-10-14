import { Download } from 'lucide-react';

/** A draft as it is written, with a button to save it. @param {{ output: string, loading: boolean, color: string, label: string, onDownload: () => void }} props */
export default function OutputPanel({ output, loading, color, label, onDownload }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" onClick={onDownload} style={{ alignSelf: 'flex-end', padding: '6px 12px', borderRadius: 8, border: 'none', background: color, color: 'white', cursor: 'pointer', fontSize: 12, display: 'flex', gap: 5, alignItems: 'center' }}>
        <Download size={13} /> {label}
      </button>
      <div style={{ flex: 1, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1.5px solid #e2e8f0', overflowY: 'auto', maxHeight: 560, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', color: '#1e293b' }}>
        {output}
        {loading && <span style={{ animation: 'caretBlink 0.8s step-end infinite' }}>▋</span>}
      </div>
    </div>
  );
}
