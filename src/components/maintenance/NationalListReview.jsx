import { authedFetch } from '../../lib/apiClient.js';
import { useState, useEffect } from 'react';
import { Bell, ShieldCheck, AlertCircle, ExternalLink, RefreshCw, CheckCircle } from 'lucide-react';
import { getReceipts } from '../../lib/db.js';

const LIST_UPDATES = [
  { id: 1, date: '2026-03-12', substance: 'Peroxyacetic acid',   type: 'Amendment',     section: '§205.601', status: 'Allowed',  desc: 'Revised usage concentrations for irrigation systems.' },
  { id: 2, date: '2026-02-28', substance: 'Oxalic acid dihydrate', type: 'New Listing', section: '§205.603', status: 'Allowed',  desc: 'Added as a pesticide for honey bee mite control.' },
  { id: 3, date: '2026-01-15', substance: 'DL-Methionine',       type: 'Sunset Review', section: '§205.603', status: 'Warning',  desc: 'Sunset date approaching in 2027; re-evaluation ongoing.' },
];

const RELEVANT_CATEGORIES = ['Fertilizer', 'Pesticide/Herbicide', 'Seed/Transplant', 'Soil Amendment', 'Cover Crop', 'Livestock Feed', 'Other Input'];

export default function NationalListReview({ userId, profile }) {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState('');
  const [scanError, setScanError] = useState('');
  const [receipts, setReceipts] = useState([]);

  useEffect(() => {
    if (!userId) return;
    getReceipts(userId).then(data => {
      setReceipts(data.filter(r => RELEVANT_CATEGORIES.includes(r.category)));
    });
  }, [userId]);

  const handleReScan = async () => {
    setScanning(true);
    setScanResult('');
    setScanError('');

    const inputList = receipts.length > 0
      ? receipts.map(r => `- ${r.product} (${r.category}, supplier: ${r.supplier || 'unknown'})`).join('\n')
      : profile?.inputs
        ? `Operation-level inputs from OSP: ${profile.inputs}`
        : 'No specific inputs on file — provide a general analysis for a California crop operation.';

    const updatesText = LIST_UPDATES.map(u =>
      `${u.substance} (${u.section}, ${u.type}): ${u.desc}`
    ).join('\n');

    try {
      const res = await authedFetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `You are Jimmy, a California organic certification expert. Cross-reference the following operation's stored inputs against the recent NOP National List updates below.

OPERATION INPUTS:
${inputList}

RECENT NATIONAL LIST UPDATES (§205.601–606):
${updatesText}

For each input, assess:
1. Whether any recent National List change affects it (flag with ✗ AFFECTED, ⚠ REVIEW, or ✓ CLEAR)
2. What specific action the grower needs to take, if any
3. Which NOP section applies

End with a summary: total inputs reviewed, how many need attention, and the single most urgent action item.

Be concise — one line per material is enough unless there's a specific concern.`,
          }],
          mode: 'national_list_review',
          stream: false,
        }),
      });

      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      setScanResult(data.content?.[0]?.text || data.choices?.[0]?.message?.content || 'No response received.');
    } catch (err) {
      setScanError(err.message);
    }

    setScanning(false);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 40 }}>
        {/* Left: Recent updates */}
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: 'var(--u-navy)' }}>Recent National List Updates</h3>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
            The USDA NOP periodically updates the list of allowed and prohibited substances (§205.601–606).
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {LIST_UPDATES.map(update => (
              <div key={update.id} style={{ padding: 16, background: 'white', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{update.date}</span>
                  <span style={{
                    fontSize: 11,
                    background: update.status === 'Warning' ? '#ffedd5' : '#f1f5f9',
                    color: update.status === 'Warning' ? '#c2410c' : '#475569',
                    padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                  }}>
                    {update.section}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {update.status === 'Warning'
                    ? <AlertCircle size={14} color="#c2410c" />
                    : <CheckCircle size={14} color="#10b981" />}
                  <h4 style={{ fontSize: 15, fontWeight: 700, color: 'var(--u-navy)' }}>{update.substance}</h4>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.4 }}>{update.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: OSP Impact Check */}
        <div style={{ background: '#f5f3ff', padding: 24, borderRadius: 16, border: '1px solid #ddd6fe', display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: 48, height: 48, background: '#8b5cf6', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Bell color="white" />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#4c1d95', marginBottom: 12 }}>OSP Impact Check</h3>
          <p style={{ fontSize: 14, color: '#5b21b6', lineHeight: 1.6, marginBottom: 20 }}>
            Jimmy cross-references your stored inputs ({receipts.length > 0 ? `${receipts.length} material${receipts.length !== 1 ? 's' : ''} from Receipt Manager` : 'from your OSP profile'}) against these National List updates.
          </p>

          {!scanResult && !scanError && (
            <div style={{ background: 'white', padding: 16, borderRadius: 12, border: '1px solid #ddd6fe', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <ShieldCheck color="#8b5cf6" size={18} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#4c1d95' }}>Ready to scan</span>
              </div>
              <p style={{ fontSize: 13, color: '#64748b' }}>
                Click "Run Full Re-Scan" to check your inputs against the {LIST_UPDATES.length} most recent National List updates.
              </p>
            </div>
          )}

          {scanResult && (
            <div style={{ background: 'white', padding: 16, borderRadius: 12, border: '1px solid #ddd6fe', marginBottom: 20, flex: 1, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <ShieldCheck color="#10b981" size={18} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>Scan Complete</span>
              </div>
              <pre style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#1e293b', fontFamily: 'inherit' }}>
                {scanResult}
              </pre>
            </div>
          )}

          {scanError && (
            <div style={{ background: '#fee2e2', padding: 12, borderRadius: 8, border: '1px solid #fecaca', marginBottom: 16, fontSize: 13, color: '#991b1b' }}>
              Error: {scanError}
            </div>
          )}

          <button
            onClick={handleReScan}
            disabled={scanning}
            style={{
              marginTop: 'auto',
              width: '100%',
              background: scanning ? '#a78bfa' : '#8b5cf6',
              color: 'white', border: 'none', padding: '12px', borderRadius: 8,
              fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, cursor: scanning ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={16} style={scanning ? { animation: 'spin 1s linear infinite' } : {}} />
            {scanning ? 'Scanning your inputs…' : 'Run Full Re-Scan'}
          </button>
        </div>
      </div>

      {/* NOSB footer */}
      <div style={{ background: 'white', border: '2px dashed #ddd6fe', padding: 24, borderRadius: 12, textAlign: 'center' }}>
        <h4 style={{ fontSize: 16, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 8 }}>Official NOP Public Comment Alerts</h4>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 16 }}>
          Stay ahead of changes. The NOSB meets twice a year to review and recommend additions to or removals from the National List.
        </p>
        <a
          href="https://www.ams.usda.gov/rules-regulations/organic/nosb"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#8b5cf6', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
        >
          View NOSB Work Agenda <ExternalLink size={14} />
        </a>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
