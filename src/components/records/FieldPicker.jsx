import { useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { findField, tidyFieldName } from '../../domain/records/fields.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';

const OTHER = '__other__';
const labelStyle = { fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 };

/**
 * The "field / block" box of a record form, when the farm has a field list: pick one of the farm's fields,
 * or "Other" and type a name that is not in the list yet. A record can name an archived field it already has
 * (kept as a choice, marked archived) and a name that is not in the list (shown typed in).
 *
 * @param {{ id: string, label: string, fields: Array<{ name: string, is_active: boolean }>, value: string,
 *   onChange: (value: string) => void, required?: boolean, invalid?: boolean, invalidText?: string }} props
 */
export default function FieldPicker({ id, label, fields, value, onChange, required = false, invalid = false, invalidText }) {
  const { lang: rawLang } = useLanguage();
  const tt = recordsText(rawLang === 'es' ? 'es' : 'en').fields.choice;

  const registered = findField(value, fields);
  // Whether the person is typing a name of their own. It starts that way for a name the list does not have,
  // and then follows their choices (so clearing the typed name does not snap the box back to the list).
  const [typing, setTyping] = useState(() => tidyFieldName(value) !== '' && !registered);
  const kept = !typing && registered && !registered.is_active ? registered : null;

  const choose = (event) => {
    const next = event.target.value;
    if (next === OTHER) {
      if (!typing) onChange('');
      setTyping(true);
      return;
    }
    setTyping(false);
    onChange(next);
  };

  const errorId = `${id}-error`;
  const marks = (shown) => ({ 'aria-invalid': shown && invalid ? 'true' : undefined, 'aria-describedby': shown && invalid ? errorId : undefined, style: shown && invalid ? ui.inputError : ui.input });

  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <select id={id} value={typing ? OTHER : registered?.name ?? ''} onChange={choose} aria-required={required ? 'true' : undefined} {...marks(!typing)}>
        <option value="">{tt.placeholder}</option>
        {fields.filter((field) => field.is_active).map((field) => <option key={field.id ?? field.name} value={field.name}>{field.name}</option>)}
        {kept && <option value={kept.name}>{`${kept.name} (${tt.archivedSuffix})`}</option>}
        <option value={OTHER}>{tt.other}</option>
      </select>

      {typing && (
        <div style={{ marginTop: 8 }}>
          <label htmlFor={`${id}-other`} style={labelStyle}>{tt.otherLabel}</label>
          <input id={`${id}-other`} type="text" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" aria-required={required ? 'true' : undefined} {...marks(true)} />
          {!registered && tidyFieldName(value) !== '' && <div style={{ color: '#92400e', fontSize: 11, marginTop: 3 }}>{tt.notInList}</div>}
        </div>
      )}

      {invalid && <div id={errorId} style={{ color: '#b91c1c', fontSize: 11, marginTop: 3 }}>{invalidText}</div>}
    </div>
  );
}
