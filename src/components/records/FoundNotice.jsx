import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { recordsText } from './text.js';
import * as ui from './ui.js';

/** The most unregistered names listed in the notice (all of them are added by its button). */
const NAMES_SHOWN = 10;

/** "N field names in your records are not in this list", with the names and a button that adds them all. */
export default function FoundNotice({ found, adding, onAdd }) {
  const { lang: rawLang } = useLanguage();
  const tt = recordsText(rawLang === 'es' ? 'es' : 'en').fields.found;

  return (
    <div style={{ ...ui.card, padding: '14px 16px', margin: '0 0 16px', background: '#fffbeb', borderColor: '#fde68a' }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: '#92400e' }}>{tt.title(found.length)}</div>
      <p style={{ fontSize: 13, color: '#78350f', margin: '4px 0' }}>{tt.body}</p>
      <p style={{ fontSize: 13, color: '#334155', margin: '0 0 10px', wordBreak: 'break-word' }}>
        {found.slice(0, NAMES_SHOWN).map((entry) => tt.uses(entry.name, entry.uses)).join(', ')}{found.length > NAMES_SHOWN ? '…' : ''}
      </p>
      <button type="button" disabled={adding} onClick={onAdd} style={{ ...ui.buttonPrimary, ...(adding ? ui.buttonDisabled : {}) }}>
        {adding ? tt.adding : tt.add}
      </button>
    </div>
  );
}
