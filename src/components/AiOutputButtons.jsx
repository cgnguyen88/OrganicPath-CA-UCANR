import { CheckCheck, Copy, Download } from 'lucide-react';

const ENGLISH = {
  copy: 'Copy',
  copied: 'Copied',
  download: 'Download Word',
  copyFailed: 'Could not copy. Select the text and copy it yourself.',
  downloadFailed: 'Could not create the Word file. Please try again.',
};

const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };
const BUTTON = { padding: '4px 10px', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 };

/**
 * Copy and Download Word buttons for a piece of AI-written text, with the result announced to screen
 * readers. Pair it with useAiOutputActions.
 *
 * @param {{
 *   actions: ReturnType<typeof import('./useAiOutputActions.js').default>,
 *   disabled?: boolean,
 *   labels?: Partial<typeof ENGLISH>,
 *   showCopy?: boolean,
 *   accent?: string,
 * }} props `disabled` is for while the text is still being written; `accent` makes the Download button solid
 */
export default function AiOutputButtons({ actions, disabled = false, labels = {}, showCopy = true, accent }) {
  const text = { ...ENGLISH, ...labels };
  const { copied, copyFailed, downloadFailed, downloading, copy, download } = actions;
  const outlined = { ...BUTTON, background: 'white', border: '1px solid #cbd5e1', color: '#1e293b' };
  const solid = { ...BUTTON, background: accent, border: 'none', color: 'white' };
  const idle = (blocked) => ({ cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.55 : 1 });
  const failure = copyFailed ? text.copyFailed : downloadFailed ? text.downloadFailed : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {showCopy && (
          <button type="button" onClick={copy} disabled={disabled} style={{ ...outlined, ...idle(disabled) }}>
            {copied ? <CheckCheck size={13} color="#047857" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? text.copied : text.copy}
          </button>
        )}
        <button type="button" onClick={download} disabled={disabled || downloading} style={{ ...(accent ? solid : outlined), ...idle(disabled || downloading) }}>
          <Download size={13} aria-hidden="true" /> {text.download}
        </button>
      </div>
      <span role="status" style={VISUALLY_HIDDEN}>{copied ? text.copied : ''}</span>
      {failure && <div role="alert" style={{ fontSize: 12, color: '#991b1b' }}>{failure}</div>}
    </div>
  );
}
