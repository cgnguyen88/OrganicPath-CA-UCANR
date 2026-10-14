import { useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { canManageFields, findField, validateFieldInput } from '../../domain/records/fields.js';
import { addFieldsByName } from '../../lib/fields.js';
import { recordsText } from './text.js';
import { useFarmFields } from './farmFields.js';
import * as ui from './ui.js';

/**
 * Under a record's field name: a quiet note when the name is not in the farm's field list (a possible typo,
 * which breaks the trail from a harvest back to where it grew), and for an owner or manager a button that adds
 * it to the list. Says nothing while the list loads, when the farm has no list yet, or when the name is in it
 * (an archived field counts: records may keep using one).
 */
export default function UnknownFieldHint({ name, farmId, role }) {
  const { lang: rawLang } = useLanguage();
  const tt = recordsText(rawLang === 'es' ? 'es' : 'en').fields;
  const { status, fields, reload } = useFarmFields();
  const [phase, setPhase] = useState('idle'); // idle | adding | added
  const [problem, setProblem] = useState(null);

  async function add() {
    setPhase('adding');
    setProblem(null);
    const { error } = await addFieldsByName(farmId, [name]);
    if (error) {
      setPhase('idle');
      setProblem(error.code);
      return;
    }
    setPhase('added');
    reload();
  }

  if (phase === 'added') return <div role="status" style={{ fontSize: 11, color: '#166534', marginTop: 3 }}>{tt.addedToList}</div>;
  if (typeof name !== 'string' || name.trim() === '' || status !== 'ready' || fields.length === 0 || findField(name, fields)) return null;

  const canAdd = canManageFields(role) && validateFieldInput({ name }).ok;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 11, color: '#92400e' }}>{tt.unknownHint(name.trim())}</div>
      {canAdd && (
        <button type="button" disabled={phase === 'adding'} onClick={add} style={{ ...ui.buttonSecondary, padding: '2px 10px', fontSize: 11, marginTop: 4, ...(phase === 'adding' ? ui.buttonDisabled : {}) }}>
          {tt.addToList}
        </button>
      )}
      {problem && <div role="alert" style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{tt.errors[problem] ?? tt.errors.unknown}</div>}
    </div>
  );
}
