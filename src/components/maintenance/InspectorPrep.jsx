import { authedFetch } from '../../lib/apiClient.js';
import { useState } from 'react';
import { Calendar as CalendarIcon, FileStack, Map, CheckSquare, Search, RefreshCw, Copy, CheckCheck } from 'lucide-react';

async function streamClaude(prompt, onChunk, onError) {
  try {
    const res = await authedFetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        mode: 'inspector_prep',
        stream: true,
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.delta?.content || json.delta?.text || '';
            if (text) onChunk(text);
          } catch {}
        }
      }
    }
  } catch (err) {
    onError(err.message);
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).setHours(0,0,0,0) - new Date().setHours(0,0,0,0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function CountdownColor(days) {
  if (days <= 7)  return '#dc2626';
  if (days <= 30) return '#f97316';
  if (days <= 60) return '#d97706';
  return '#10b981';
}

const ACTIONS = [
  {
    id: 'documents',
    icon: FileStack,
    title: 'Document Portfolio',
    desc: 'Generate a complete list of documents to have ready at inspection.',
    prompt: (d, p) => `Generate a complete Document Portfolio checklist for a ${p?.operationType || 'crop production'} organic operation preparing for a ${d.certifier || 'certifier'} annual inspection on ${d.date || 'an upcoming date'}.

Operation: ${p?.operationName || 'Certified Organic Operation'}
County: ${p?.county || 'California'}
Operation Type: ${p?.operationType || 'Crop Production'}

List every document a certifier will ask to see, organized by category (OSP Documents, Input Records, Field/Land Records, Harvest & Sales Records, Equipment Records). For each document, note the NOP section it fulfills. Flag which items are "must have day-of" vs "available on request."`,
  },
  {
    id: 'site',
    icon: Map,
    title: 'Site Inspection Pack',
    desc: 'Tailored walkthrough of physical site requirements for your operation type.',
    prompt: (d, p) => `Generate a Site Inspection Walkthrough for a ${p?.operationType || 'crop production'} organic operation for a ${d.certifier || 'certifier'} inspection.

Operation: ${p?.operationName || 'Certified Organic Operation'}
County: ${p?.county || 'California'}
Acreage: ${p?.acreage || 'not specified'}
Crops: ${p?.crops || 'not specified'}

List every physical site element an inspector will walk through and verify. For each, describe what the inspector looks for, what the grower should prepare, and the relevant NOP regulation. Include: field boundaries & buffer zones (§205.202), equipment (§205.272), storage areas, signage, composting if applicable (§205.203), and water sources.`,
  },
  {
    id: 'walkthrough',
    icon: CheckSquare,
    title: 'Pre-Inspection Walkthrough',
    desc: 'Self-inspection checklist to run 1–2 weeks before the inspector arrives.',
    prompt: (d, p) => `Create a Pre-Inspection Walkthrough Checklist for a ${p?.operationType || 'crop production'} grower to complete 1–2 weeks before their ${d.certifier || 'certifier'} inspection.

Operation: ${p?.operationName || 'Certified Organic Operation'}
Inspection Date: ${d.date || 'upcoming'}

Format as an actionable checklist organized by area (Records & Documentation, Physical Farm, Inputs & Storage, Buffer Zones, Equipment). Each item should be a specific action ("Confirm all application logs include lot numbers" not just "Check logs"). Flag the top 5 most common non-compliance findings inspectors cite so the grower can double-check those areas.`,
  },
  {
    id: 'findings',
    icon: Search,
    title: 'Previous Findings Review',
    desc: 'Verify closure of past non-compliance findings before the inspector arrives.',
    prompt: (d, _p) => `Draft a Previous Findings Review template for a certified organic operation preparing for their ${d.certifier || 'certifier'} annual inspection.

This template should help the grower:
1. Document any non-compliance findings from the previous inspection cycle
2. Verify corrective actions are fully implemented and documented
3. Prepare evidence to show the inspector that each finding has been resolved
4. Flag any findings that are still partially unresolved

Include a table structure for tracking each finding (finding description, NOP section, corrective action taken, date resolved, evidence available). Also list the 8 most common repeat findings in California organic crop operations so the grower knows what to proactively address.`,
  },
];

export default function InspectorPrep({ profile }) {
  const [inspectionData, setInspectionData] = useState({
    date: '',
    certifier: profile?.certifierName || '',
    operationType: profile?.operationType || 'Crop Production',
  });
  const [activeAction, setActiveAction] = useState(null);
  const [outputs, setOutputs] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [copied, setCopied] = useState(null);

  const days = daysUntil(inspectionData.date);

  const handleGenerate = async (action) => {
    setActiveAction(action.id);
    setLoadingId(action.id);
    setOutputs(prev => ({ ...prev, [action.id]: '' }));

    const prompt = action.prompt(inspectionData, profile);
    await streamClaude(
      prompt,
      (chunk) => setOutputs(prev => ({ ...prev, [action.id]: (prev[action.id] || '') + chunk })),
      (err) => { setOutputs(prev => ({ ...prev, [action.id]: `Error: ${err}` })); }
    );
    setLoadingId(null);
  };

  const handleCopy = (id) => {
    navigator.clipboard.writeText(outputs[id] || '');
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      {/* Schedule + Countdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 40 }}>
        <div style={{ background: 'white', padding: 24, borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Inspection Schedule</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Scheduled Date</label>
              <input
                type="date"
                value={inspectionData.date}
                onChange={e => setInspectionData({ ...inspectionData, date: e.target.value })}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Certifying Agency</label>
              <input
                type="text"
                value={inspectionData.certifier}
                onChange={e => setInspectionData({ ...inspectionData, certifier: e.target.value })}
                placeholder="e.g. CCOF, OTCO, CDFA"
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--u-navy)', color: 'white', padding: 24, borderRadius: 12, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, opacity: 0.7, marginBottom: 8 }}>Inspection Countdown</h3>
            {days === null ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 900 }}>Set a Date</div>
                <p style={{ fontSize: 13, opacity: 0.6, marginTop: 6 }}>Enter your inspection date to activate prep tools.</p>
              </>
            ) : days < 0 ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#fca5a5' }}>Passed</div>
                <p style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
                  {inspectionData.certifier} inspection was {Math.abs(days)} day{Math.abs(days) !== 1 ? 's' : ''} ago.
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 48, fontWeight: 900, color: CountdownColor(days), lineHeight: 1 }}>{days}</div>
                <div style={{ fontSize: 14, opacity: 0.8, marginTop: 4 }}>day{days !== 1 ? 's' : ''} until inspection</div>
                <p style={{ fontSize: 13, opacity: 0.6, marginTop: 8 }}>
                  {inspectionData.certifier || 'Inspection'} · {new Date(inspectionData.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
                {days <= 30 && (
                  <div style={{ marginTop: 12, background: 'rgba(220,38,38,0.2)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#fca5a5', display: 'inline-block' }}>
                    {days <= 7 ? '⚠ Urgent — prep now' : '⚠ Less than 30 days — finalize docs'}
                  </div>
                )}
              </>
            )}
          </div>
          <CalendarIcon size={110} style={{ position: 'absolute', right: -20, bottom: -20, opacity: 0.08 }} />
        </div>
      </div>

      {/* Action Cards */}
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--u-navy)' }}>Prep Tools</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 32 }}>
        {ACTIONS.map(action => (
          <div
            key={action.id}
            style={{ padding: 20, background: 'white', borderRadius: 12, border: activeAction === action.id ? '2px solid var(--u-gold)' : '1.5px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.15s' }}
            onClick={() => !loadingId && handleGenerate(action)}
          >
            <action.icon size={24} color="var(--u-gold)" style={{ marginBottom: 12 }} />
            <h4 style={{ fontSize: 15, fontWeight: 700, color: 'var(--u-navy)', marginBottom: 6 }}>{action.title}</h4>
            <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 14 }}>{action.desc}</p>
            <button
              disabled={!!loadingId}
              style={{ background: 'none', border: 'none', color: loadingId === action.id ? '#94a3b8' : 'var(--u-gold)', fontWeight: 600, fontSize: 13, cursor: loadingId ? 'not-allowed' : 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {loadingId === action.id
                ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
                : 'Generate →'}
            </button>
          </div>
        ))}
      </div>

      {/* Output panel */}
      {activeAction && outputs[activeAction] !== undefined && (
        <div style={{ background: '#f8fafc', borderRadius: 12, border: '1.5px solid #e2e8f0', padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#475569' }}>
              {ACTIONS.find(a => a.id === activeAction)?.title.toUpperCase()}
            </h4>
            {outputs[activeAction] && (
              <button
                onClick={() => handleCopy(activeAction)}
                style={{ background: 'white', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                {copied === activeAction ? <CheckCheck size={13} color="#10b981" /> : <Copy size={13} />}
                {copied === activeAction ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>

          {outputs[activeAction] ? (
            <pre style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#1e293b', fontFamily: 'inherit' }}>
              {outputs[activeAction]}
            </pre>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#64748b', fontSize: 13 }}>
              <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Jimmy is generating your {ACTIONS.find(a => a.id === activeAction)?.title.toLowerCase()}…
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
