import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { STATUS_TONE } from '../../domain/records/workflow.js';
import { recordsText } from './text.js';
import { TONES } from './ui.js';

export default function StatusBadge({ status }) {
  const { lang } = useLanguage();
  const tone = TONES[STATUS_TONE[status]] ?? TONES.neutral;
  return (
    <span style={{ ...tone, padding: '2px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {recordsText(lang).status[status] ?? status}
    </span>
  );
}
