import AiText from '../AiText.jsx';
import AiOutputButtons from '../AiOutputButtons.jsx';

/**
 * A draft laid out as a document, with Copy and Download Word. While the draft is being written, or after
 * the writing failed, the buttons are off: half a draft must not be saved as if it were finished.
 *
 * @param {{
 *   output: string, loading: boolean, error?: string, color: string,
 *   actions: ReturnType<typeof import('../useAiOutputActions.js').default>,
 *   labels: Parameters<typeof AiOutputButtons>[0]['labels'],
 * }} props
 */
export default function OutputPanel({ output, loading, error = '', color, actions, labels }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <AiOutputButtons actions={actions} disabled={loading || Boolean(error)} accent={color} labels={labels} />
      {error && <div role="alert" style={{ fontSize: 13, color: '#991b1b', background: '#fee2e2', padding: '8px 12px', borderRadius: 8 }}>[Error: {error}]</div>}
      <div style={{ flex: 1, padding: '16px 18px', background: 'white', borderRadius: 10, border: '1.5px solid #e2e8f0', overflowY: 'auto', maxHeight: 560 }}>
        <AiText text={output} />
        {loading && <span aria-hidden="true" style={{ animation: 'caretBlink 0.8s step-end infinite' }}>▋</span>}
      </div>
    </div>
  );
}
