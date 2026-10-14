import { authedFetch } from '../../lib/apiClient.js';
import { useState, useEffect } from 'react';
import { Layers, CheckCircle, AlertTriangle, RefreshCw, Search, Info, Plus, X, CheckCheck } from 'lucide-react';
import { getReceipts } from '../../lib/db.js';
import { saveToStorage, loadFromStorage } from '../../utils/storage.js';

const MANUAL_KEY = 'orgpath_manual_inputs';

const RELEVANT_CATEGORIES = new Set([
  'Fertilizer', 'Pesticide/Herbicide', 'Seed/Transplant', 'Soil Amendment',
  'Cover Crop', 'Livestock Feed', 'Other Input',
  'Fertilizante', 'Pesticida/Herbicida', 'Semilla/Trasplante', 'Enmienda del Suelo',
  'Cultivo de Cobertura', 'Alimento para Ganado', 'Otro Insumo',
]);

function staleness(dateStr) {
  if (!dateStr) return 'unknown';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days > 365) return 'overdue';
  if (days > 270) return 'due-soon';
  return 'ok';
}

export default function InputVerification({ userId }) {
  const [receipts, setReceipts] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState('');
  const [verifyError, setVerifyError] = useState('');

  // manual input list — persisted to localStorage
  const [manualInputs, setManualInputs] = useState(() => loadFromStorage(MANUAL_KEY, ''));
  const [showManual, setShowManual] = useState(false);
  const [savedConfirm, setSavedConfirm] = useState(false);

  // auto-open manual panel when there are no receipts (once loaded)
  useEffect(() => {
    if (loadState === 'loaded' && receipts.length === 0) {
      setShowManual(true);
    }
  }, [loadState, receipts.length]);

  useEffect(() => {
    if (!userId) { setLoadState('loaded'); return; }
    getReceipts(userId)
      .then(data => {
        setReceipts(data.filter(r => RELEVANT_CATEGORIES.has(r.category)));
        setLoadState('loaded');
      })
      .catch(err => {
        console.error('InputVerification:', err);
        setLoadError(err.message || 'Failed to load receipts');
        setLoadState('error');
      });
  }, [userId]);

  const handleSaveManual = () => {
    saveToStorage(MANUAL_KEY, manualInputs);
    setSavedConfirm(true);
    setTimeout(() => setSavedConfirm(false), 2000);
  };

  const buildInputList = () => {
    const fromReceipts = receipts.length > 0
      ? receipts.map(r =>
          `- ${r.product} (${r.category}, supplier: ${r.supplier || 'unknown'}, OMRI listed: ${r.omri_listed === true ? 'Yes' : r.omri_listed === false ? 'No' : 'Unknown'})`
        ).join('\n')
      : '';
    const fromManual = manualInputs.trim();
    const combined = [fromReceipts, fromManual].filter(Boolean).join('\n');
    return combined || null;
  };

  const handleVerify = async () => {
    const inputList = buildInputList();
    if (!inputList) return;
    setVerifying(true);
    setVerifyResult('');
    setVerifyError('');
    try {
      const res = await authedFetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Review these inputs from a USDA-certified organic operation. For each material:
1. Confirm if it is typically OMRI-listed or NOP-compliant
2. Note any known restrictions or annotation requirements under §205.601–606
3. Flag any re-verification steps needed for the upcoming certification year

INPUTS:
${inputList}

Format: one line per input. Prefix each with ✓ CLEAR, ⚠ REVIEW, or ✗ ISSUE. End with a 2–3 line summary of the most urgent actions.`,
          }],
          mode: 'input_verification',
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      const data = await res.json();
      const text = data.content?.[0]?.text || data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from Claude');
      setVerifyResult(text);
    } catch (err) {
      setVerifyError(err.message);
    }
    setVerifying(false);
  };

  const canVerify = receipts.length > 0 || manualInputs.trim().length > 0;

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#64748b', gap: 12 }}>
        <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
        Loading your materials…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div>
        <div style={{ padding: 24, background: '#fee2e2', borderRadius: 12, border: '1px solid #fecaca', color: '#991b1b', marginBottom: 24 }}>
          <h4 style={{ fontWeight: 700, marginBottom: 6 }}>Could not load receipts</h4>
          <p style={{ fontSize: 13 }}>{loadError}</p>
        </div>
        {/* Still allow manual entry even on error */}
        <ManualPanel
          value={manualInputs}
          onChange={setManualInputs}
          onSave={handleSaveManual}
          savedConfirm={savedConfirm}
          onClose={null}
        />
      </div>
    );
  }

  // ── Main ─────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 4 }}>Annual Material Re-verification</h3>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            {receipts.length > 0
              ? `${receipts.length} material${receipts.length !== 1 ? 's' : ''} loaded from Receipt Manager.${manualInputs.trim() ? ' Manual entries also included.' : ''}`
              : 'No receipts found for relevant categories. Enter inputs manually below or add them in Receipt Manager.'}
          </p>
        </div>
        <button
          onClick={handleVerify}
          disabled={verifying || !canVerify}
          style={{
            background: verifying || !canVerify ? '#94a3b8' : '#f97316',
            color: 'white', border: 'none', padding: '10px 18px', borderRadius: 8,
            fontWeight: 600, cursor: verifying || !canVerify ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}
        >
          {verifying
            ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…</>
            : <><Search size={16} /> Re-verify with Jimmy</>}
        </button>
      </div>

      {/* Receipt table */}
      {receipts.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, border: '1.5px solid #e2e8f0', overflow: 'hidden', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
                {['MATERIAL', 'SUPPLIER', 'CATEGORY', 'LAST PURCHASED', 'OMRI STATUS'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#475569' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => {
                const stale = staleness(r.date);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 600, color: 'var(--u-navy)' }}>{r.product || '—'}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#64748b' }}>{r.supplier || '—'}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ background: '#f1f5f9', color: '#475569', fontSize: 11, padding: '3px 8px', borderRadius: 20, fontWeight: 600 }}>{r.category}</span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: stale === 'overdue' ? '#e11d48' : stale === 'due-soon' ? '#d97706' : '#64748b' }}>
                      {r.date || '—'}
                      {stale === 'overdue' && <span style={{ fontSize: 10, display: 'block', fontWeight: 600, marginTop: 2 }}>⚠ Verify this year</span>}
                      {stale === 'due-soon' && <span style={{ fontSize: 10, display: 'block', fontWeight: 600, marginTop: 2 }}>Review soon</span>}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {r.omri_listed === true
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ecfdf5', color: '#10b981', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}><CheckCircle size={12} /> OMRI Listed</span>
                        : r.omri_listed === false
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff1f2', color: '#e11d48', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}><AlertTriangle size={12} /> Review Required</span>
                          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f8fafc', color: '#94a3b8', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Unknown</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state when no receipts */}
      {receipts.length === 0 && (
        <div style={{ background: '#f8fafc', border: '2px dashed #e2e8f0', borderRadius: 12, padding: 28, textAlign: 'center', marginBottom: 24 }}>
          <Layers size={28} color="#cbd5e1" style={{ margin: '0 auto 10px' }} />
          <h4 style={{ fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 6 }}>No receipts in relevant categories</h4>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 420, margin: '0 auto' }}>
            Add fertilizers, pesticides, seeds, and soil amendments in Receipt Manager, or enter them manually below.
          </p>
        </div>
      )}

      {/* Manual panel toggle (only when there are receipts — otherwise it auto-opens) */}
      {receipts.length > 0 && (
        <button
          onClick={() => setShowManual(v => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'white', border: '1.5px solid #e2e8f0', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--u-navy)', marginBottom: 16 }}
        >
          {showManual ? <><X size={14} /> Hide manual entry</> : <><Plus size={14} /> Add inputs manually</>}
        </button>
      )}

      {/* Manual entry panel */}
      {showManual && (
        <ManualPanel
          value={manualInputs}
          onChange={setManualInputs}
          onSave={handleSaveManual}
          savedConfirm={savedConfirm}
          onClose={receipts.length > 0 ? () => setShowManual(false) : null}
        />
      )}

      {/* Claude result */}
      {verifyError && (
        <div style={{ marginBottom: 20, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 10, padding: 16, fontSize: 13, color: '#991b1b' }}>
          <strong>Error:</strong> {verifyError}
        </div>
      )}
      {verifyResult && (
        <div style={{ marginBottom: 24, background: '#f5f3ff', border: '1.5px solid #ddd6fe', borderRadius: 12, padding: 24 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, color: '#4c1d95', marginBottom: 12 }}>Jimmy's Re-verification Analysis</h4>
          <pre style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#1e293b', fontFamily: 'inherit' }}>{verifyResult}</pre>
        </div>
      )}

      {/* §205.204 tip */}
      <div style={{ padding: 20, background: '#fff7ed', borderRadius: 12, border: '1px solid #ffedd5' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Info size={18} color="#c2410c" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 4 }}>Seed & Planting Stock (§205.204)</h4>
            <p style={{ fontSize: 13, color: '#9a3412', lineHeight: 1.5 }}>
              Non-organic seeds require documentation that organic varieties were commercially unavailable. Add seed purchase records in Receipt Manager to track this here.
            </p>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ManualPanel({ value, onChange, onSave, savedConfirm, onClose }) {
  return (
    <div style={{ marginBottom: 24, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--u-navy)' }}>Manual input list</label>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}>
            <X size={16} />
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        One input per line — e.g. "PyGanic EC 5.0 (pesticide, MGK)" or "Feather Meal 12-0-0 (fertilizer, Nature Safe)"
      </p>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={5}
        placeholder={"PyGanic EC 5.0 (pesticide, MGK)\nFeather Meal 12-0-0 (fertilizer, Nature Safe)\nCopper Sulfate (fungicide, generic)"}
        style={{ width: '100%', padding: 12, borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 12 }}
      />
      <button
        onClick={onSave}
        disabled={!value.trim()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: savedConfirm ? '#10b981' : value.trim() ? 'var(--u-navy)' : '#94a3b8',
          color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8,
          fontSize: 13, fontWeight: 600, cursor: value.trim() ? 'pointer' : 'not-allowed',
          transition: 'background 0.2s',
        }}
      >
        {savedConfirm ? <><CheckCheck size={14} /> Saved</> : <>Save list</>}
      </button>
      <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>Saved inputs persist across sessions</span>
    </div>
  );
}
