import { authedFetch } from '../../lib/apiClient.js';
import { useState } from 'react';
import AiText from '../AiText.jsx';
import useAiOutputActions from '../useAiOutputActions.js';
import AiOutputButtons from '../AiOutputButtons.jsx';
import { RefreshCw, Sparkles } from 'lucide-react';

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

export default function OSPUpdateWorkflow({ profile }) {
  const [changes, setChanges] = useState({
    newFields: '',
    newInputs: '',
    newCrops: '',
    newBuyers: '',
    newPractices: '',
  });
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const actions = useAiOutputActions(output, () => ({
    title: 'Annual OSP Update',
    subtitle: [profile?.operationName, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })].filter(Boolean).join(' · '),
    markdown: output, lang: 'en', filename: `OSP-Update-${new Date().getFullYear()}-${profile?.operationName || 'operation'}`,
  }));

  const handleGenerate = async () => {
    setLoading(true);
    setOutput('');
    setError('');

    const changesText = [
      changes.newFields    && `New Fields/Land: ${changes.newFields}`,
      changes.newInputs    && `New Inputs/Materials: ${changes.newInputs}`,
      changes.newCrops     && `New Crops/Products: ${changes.newCrops}`,
      changes.newBuyers    && `New Buyers/Markets: ${changes.newBuyers}`,
      changes.newPractices && `Changed Practices: ${changes.newPractices}`,
    ].filter(Boolean).join('\n') || 'No material changes this year — continuity affirmation only.';

    const prompt = `Generate an Annual OSP Update document (NOP §205.406 continuation of certification) for:

Operation: ${profile?.operationName || 'Certified Organic Operation'}
Owner: ${profile?.ownerName || ''}
County: ${profile?.county || 'California'}
Operation Type: ${profile?.operationType || 'Crop Production'}
Certifier: ${profile?.certifierName || 'Certifying Agent'}
Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

CHANGES THIS YEAR:
${changesText}

Start with the document header as plain lines (operation name, owner, certifier, date). Then write these sections, each under its own ## heading:
- Summary of Annual Changes: list each change category; note "No changes" where blank
- Regulatory Compliance Attestation: verify all new fields meet the 36-month transition per §205.202, all new inputs are verified against the National List §205.601–606, and all new handling practices meet §205.270
- Recordkeeping Update: list what new records have been added per §205.103
- Grower Affirmation: a formal statement that the OSP on file remains current except as noted, with a blank signature block

Be formal and precise. Reference specific NOP sections. This document goes directly to the certifier.`;

    await streamClaude(
      [{ role: 'user', content: prompt }],
      { mode: 'osp_update' },
      (chunk) => setOutput(prev => prev + chunk),
      (err) => { setError(err); setLoading(false); }
    );

    setLoading(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 40 }}>
      {/* Left: Input form */}
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>What changed this year?</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
          Leave fields blank if nothing changed — Jimmy will include a "no change" affirmation for that category.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[
            ['newFields',    'New land or fields added to the operation?'],
            ['newInputs',    'New fertilizers, amendments, or pest controls?'],
            ['newCrops',     'New crops, varieties, or product lines?'],
            ['newBuyers',    'New markets, buyers, or sales channels?'],
            ['newPractices', 'Changes to tillage, rotation, or harvest practices?'],
          ].map(([key, label]) => (
            <div key={key}>
              <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'block', color: '#374151' }}>{label}</label>
              <textarea
                value={changes[key]}
                onChange={e => setChanges(c => ({ ...c, [key]: e.target.value }))}
                style={{ width: '100%', padding: 12, borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                rows={2}
                placeholder="Describe changes, or leave blank for none…"
              />
            </div>
          ))}

          {error && (
            <div role="alert" style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: 13 }}>
              Error: {error}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{
              background: loading ? '#94a3b8' : 'var(--u-navy)', color: 'white', padding: '13px',
              borderRadius: 8, border: 'none', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14,
            }}
          >
            {loading ? <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={18} />}
            {loading ? 'Generating §205.406 document…' : 'Generate §205.406 Update Document'}
          </button>
        </div>
      </div>

      {/* Right: Preview */}
      <div style={{ background: '#f8fafc', borderRadius: 12, padding: 24, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#475569' }}>DOCUMENT PREVIEW</h4>
          {output && <AiOutputButtons actions={actions} disabled={loading || Boolean(error)} />}
        </div>

        {output ? (
          <div style={{ flex: 1, overflowY: 'auto', background: 'white', borderRadius: 8, border: '1px solid #cbd5e1', padding: '16px 18px' }}><AiText text={output} headingStart={5} /></div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 32 }}>
            {loading ? 'Jimmy is drafting your §205.406 continuation document…' : 'Enter any changes above and click generate to create your annual OSP update draft.'}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
