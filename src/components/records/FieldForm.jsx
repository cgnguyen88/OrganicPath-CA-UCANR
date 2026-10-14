import { useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { validateFieldInput } from '../../domain/records/fields.js';
import { createField, updateField } from '../../lib/fields.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import Modal from './Modal.jsx';

const UNITS = ['acre', 'hectare', 'sq_ft'];
/** The boxes of the form, in order, with the key their complaints go under. */
const BOXES = [{ key: 'name', id: 'field-name' }, { key: 'area', id: 'field-area' }, { key: 'area_unit', id: 'field-unit' }, { key: 'notes', id: 'field-notes' }];
const labelStyle = { fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 };
const helpStyle = { color: '#64748b', fontSize: 11, marginTop: 3 };
const errorStyle = { color: '#b91c1c', fontSize: 11, marginTop: 3 };

const startingValues = (field) => ({
  name: field?.name ?? '',
  area: field?.area === null || field?.area === undefined ? '' : String(Number(field.area)),
  area_unit: field?.area_unit ?? '',
  notes: field?.notes ?? '',
});

/** One box of the form, with its label, its hint and its complaint. */
function Box({ id, label, error, errorText, help, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${id}-error` : help ? `${id}-help` : undefined, style: error ? ui.inputError : ui.input })}
      {error ? <div id={`${id}-error`} role="alert" style={errorStyle}>{errorText}</div> : help && <div id={`${id}-help`} style={helpStyle}>{help}</div>}
    </div>
  );
}

/**
 * Add a field, or change one (its name unless records use it, its area and notes). Checks what was typed
 * first, so each complaint sits next to its box; the database enforces the same rules.
 */
export default function FieldForm({ farmId, field, nameLocked = false, onSaved, onCancel }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang).fields;

  const [values, setValues] = useState(() => startingValues(field));
  const [errors, setErrors] = useState({});
  const [alertCode, setAlertCode] = useState(null);
  const [busy, setBusy] = useState(false);

  const change = (key) => (event) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)));
  };
  // A unit is complained about as "choose a unit", whatever the complaint (missing or not one of ours).
  const complaint = (key) => (errors[key] ? tt.errors[key === 'area_unit' ? 'unit' : errors[key]] ?? tt.errors.invalid : null);

  // Show what is wrong next to its box and put the cursor in the first such box.
  function complain(complaints) {
    setErrors(complaints);
    const first = BOXES.find((box) => complaints[box.key]);
    if (first) document.getElementById(first.id)?.focus();
  }

  async function save() {
    const checked = validateFieldInput(values);
    if (!checked.ok) {
      complain(checked.errors);
      return;
    }
    setBusy(true);
    setAlertCode(null);
    const result = field ? await updateField(field.id, values) : await createField({ farmId, ...values });
    setBusy(false);
    if (result.error?.fields) {
      complain(result.error.fields);
      return;
    }
    // A name that is taken, or that records use, is a complaint about the name box.
    if (result.error?.code === 'duplicate' || result.error?.code === 'in_use') {
      complain({ name: result.error.code });
      return;
    }
    if (result.error) {
      setAlertCode(result.error.code);
      return;
    }
    onSaved?.(result.data);
  }

  return (
    <Modal title={field ? tt.form.editTitle : tt.form.addTitle} onClose={onCancel} dismissible={!busy}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); if (!busy) save(); }}>
        <Box id="field-name" label={tt.form.name} error={errors.name} errorText={complaint('name')} help={nameLocked ? tt.form.renameLocked : tt.form.nameHelp}>
          {(props) => <input {...props} type="text" value={values.name} readOnly={nameLocked} onChange={change('name')} autoComplete="off" />}
        </Box>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <Box id="field-area" label={tt.form.area} error={errors.area} errorText={complaint('area')}>
              {(props) => <input {...props} type="text" inputMode="decimal" value={values.area} onChange={change('area')} autoComplete="off" />}
            </Box>
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <Box id="field-unit" label={tt.form.unit} error={errors.area_unit} errorText={complaint('area_unit')}>
              {(props) => (
                <select {...props} value={values.area_unit} onChange={change('area_unit')}>
                  <option value="" />
                  {UNITS.map((unit) => <option key={unit} value={unit}>{tt.units[unit]}</option>)}
                </select>
              )}
            </Box>
          </div>
        </div>

        <Box id="field-notes" label={tt.form.notes} error={errors.notes} errorText={complaint('notes')}>
          {(props) => <textarea {...props} rows={3} value={values.notes} onChange={change('notes')} style={{ ...props.style, resize: 'vertical' }} />}
        </Box>

        {alertCode && (
          <div role="alert" style={{ marginBottom: 14, padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 }}>
            {tt.errors[alertCode] ?? tt.errors.unknown}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={{ ...ui.buttonSecondary, ...(busy ? ui.buttonDisabled : {}) }}>{tt.form.cancel}</button>
          <button type="submit" disabled={busy} style={{ ...ui.buttonPrimary, ...(busy ? ui.buttonDisabled : {}) }}>{busy ? tt.form.saving : tt.form.save}</button>
        </div>
      </form>
    </Modal>
  );
}
