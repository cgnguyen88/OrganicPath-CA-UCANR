import { authedFetch } from '../../lib/apiClient.js';
import { useState } from 'react';
import { AlertTriangle, FileEdit, Copy, CheckCheck, RefreshCw, Download } from 'lucide-react';

async function streamClaude(messages, assistant, onChunk, onError) {
  try {
    const res = await authedFetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...assistant, stream: true }),
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

export default function ActionResponse({ profile }) {
  const [notice, setNotice] = useState({
    type: 'Non-compliance',
    issue: '',
    regulatoryReference: '',
    dateReceived: new Date().toISOString().split('T')[0],
  });
  const [generating, setGenerating] = useState(false);
  const [responseDraft, setResponseDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleDraft = async () => {
    if (!notice.issue.trim()) return;
    setGenerating(true);
    setResponseDraft('');
    setError('');

    const prompt = `Draft a formal corrective action response letter for a USDA-certified organic operation.

NOTICE DETAILS:
- Notice Type: ${notice.type}
- Date Received: ${notice.dateReceived}
- Regulatory Reference: ${notice.regulatoryReference || 'Not specified — infer likely NOP section from the issue'}
- Issue Summary: ${notice.issue}

OPERATION INFO:
- Operation Name: ${profile?.operationName || '[Operation Name]'}
- Certifier: ${profile?.certifierName || '[Certifying Agent]'}
- Operation Type: ${profile?.operationType || 'Crop Production'}
- County: ${profile?.county || 'California'}

Draft a complete formal response letter with these sections:
1. HEADER — operation name, certifier, date, re: notice type + regulatory reference
2. ACKNOWLEDGMENT — acknowledge receipt of the notice (not an admission of fault, just acknowledgment)
3. DESCRIPTION OF FINDING — restate the finding clearly in the operation's own words
4. ROOT CAUSE ANALYSIS — specific, honest analysis of how this occurred
5. CORRECTIVE ACTIONS TAKEN — concrete, specific steps already implemented (include dates)
6. PREVENTIVE MEASURES — systemic changes to prevent recurrence
7. SUPPORTING DOCUMENTATION LIST — bulleted list of evidence documents to attach
8. AFFIRMATION & SIGNATURE BLOCK — formal attestation statement

Be specific and regulatory-precise. Vague responses get rejected by certifiers. Reference NOP sections directly.`;

    await streamClaude(
      [{ role: 'user', content: prompt }],
      { mode: 'action_response' },
      (chunk) => setResponseDraft(prev => prev + chunk),
      (err) => { setError(err); setGenerating(false); }
    );

    setGenerating(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(responseDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([responseDraft], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Corrective-Action-Response-${notice.dateReceived}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ marginBottom: 28, display: 'flex', gap: 16, alignItems: 'center', background: '#fee2e2', padding: 16, borderRadius: 8, border: '1px solid #fecaca' }}>
        <AlertTriangle color="#dc2626" size={20} />
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#991b1b' }}>Response Assistant</h3>
          <p style={{ fontSize: 13, color: '#991b1b', lineHeight: 1.4 }}>
            Received an adverse action notice? Jimmy helps you draft a rigorous corrective action response that satisfies NOP §205.660–681 requirements.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        {/* Left: Notice Details */}
        <div style={{ background: 'white', padding: 24, borderRadius: 12, border: '1.5px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Notice Details</h4>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Notice Type</label>
            <select
              value={notice.type}
              onChange={e => setNotice({ ...notice, type: e.target.value })}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13 }}
            >
              <option>Non-compliance</option>
              <option>Proposed Suspension</option>
              <option>Proposed Revocation</option>
              <option>Denial of Certification</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Date Notice Received</label>
            <input
              type="date"
              value={notice.dateReceived}
              onChange={e => setNotice({ ...notice, dateReceived: e.target.value })}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Regulatory Reference (e.g. §205.103)</label>
            <input
              type="text"
              value={notice.regulatoryReference}
              onChange={e => setNotice({ ...notice, regulatoryReference: e.target.value })}
              placeholder="e.g. §205.103, §205.204 — or leave blank"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>
              Describe the Finding <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              rows={4}
              value={notice.issue}
              onChange={e => setNotice({ ...notice, issue: e.target.value })}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
              placeholder="Paste or summarize the finding from your certifier's notice…"
            />
          </div>

          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 13 }}>
              Error: {error}
            </div>
          )}

          <button
            onClick={handleDraft}
            disabled={generating || !notice.issue.trim()}
            style={{
              background: generating || !notice.issue.trim() ? '#94a3b8' : '#dc2626',
              color: 'white', padding: '12px', border: 'none',
              borderRadius: 8, fontWeight: 700, cursor: generating || !notice.issue.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {generating
              ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Drafting response…</>
              : <><FileEdit size={16} /> Draft Corrective Action Response</>
            }
          </button>
        </div>

        {/* Right: Draft output */}
        <div style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#475569' }}>DRAFT RESPONSE</h4>
            {responseDraft && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleCopy}
                  style={{ background: 'white', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {copied ? <CheckCheck size={13} color="#10b981" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  style={{ background: 'white', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Download size={13} /> Download
                </button>
              </div>
            )}
          </div>

          {responseDraft ? (
            <div style={{ flex: 1, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#1e293b', background: 'white', padding: 16, borderRadius: 8, border: '1px solid #cbd5e1', overflowY: 'auto', maxHeight: 520 }}>
              {responseDraft}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 32 }}>
              {generating
                ? 'Jimmy is drafting your corrective action response…'
                : 'Describe the finding from your certifier and click "Draft" to generate a regulatory-compliant response letter.'}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
