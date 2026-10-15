import { useCallback, useEffect, useRef, useState } from 'react';
import { copyAiText } from '../utils/markdown/clipboard.js';

const COPIED_MS = 2000;
const NOTHING_TO_REPORT = { copied: false, copyFailed: false, downloadFailed: false };

/**
 * The Copy and Download buttons that sit beside AI-written text: copy as clean text, download as a
 * Word document. Neither throws. What the buttons report (copied, failed) belongs to the text it
 * was about, so it disappears when the text changes.
 *
 * @param {string} markdown the text as the model wrote it
 * @param {() => Parameters<typeof import('../utils/markdown/aiDocument.js').downloadAiDocx>[0]} makeDocument what to put in the Word file
 */
export default function useAiOutputActions(markdown, makeDocument) {
  const [report, setReport] = useState({ markdown, ...NOTHING_TO_REPORT });
  const [downloading, setDownloading] = useState(false);
  const mounted = useRef(true);
  const timer = useRef(null);
  const downloadInFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const current = report.markdown === markdown ? report : { markdown, ...NOTHING_TO_REPORT };

  /** Records what happened for `markdown`; ignored if the text has changed since, or the screen is gone. */
  const note = useCallback((patch) => {
    if (!mounted.current) return;
    setReport((previous) => (previous.markdown === markdown ? { ...previous, ...patch } : { markdown, ...NOTHING_TO_REPORT, ...patch }));
  }, [markdown]);

  const copy = async () => {
    const worked = await copyAiText(markdown);
    clearTimeout(timer.current);
    note({ copied: worked, copyFailed: !worked, downloadFailed: false });
    if (worked && mounted.current) timer.current = setTimeout(() => note({ copied: false }), COPIED_MS);
  };

  const download = async () => {
    if (downloadInFlight.current) return;
    downloadInFlight.current = true;
    setDownloading(true);
    note({ downloadFailed: false, copyFailed: false });
    try {
      const { downloadAiDocx } = await import('../utils/markdown/aiDocument.js');
      await downloadAiDocx(makeDocument());
    } catch (error) {
      console.error('Could not create the Word file', error);
      note({ downloadFailed: true });
    } finally {
      downloadInFlight.current = false;
      if (mounted.current) setDownloading(false);
    }
  };

  return { copied: current.copied, copyFailed: current.copyFailed, downloadFailed: current.downloadFailed, downloading, copy, download };
}
