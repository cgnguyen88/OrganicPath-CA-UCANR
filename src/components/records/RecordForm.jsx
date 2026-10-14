import { useMemo, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext.jsx';
import { KIND_FIELDS, KIND_META, requiredFieldKeys } from '../../domain/records/kinds.js';
import { evaluateRecord } from '../../domain/records/schemas.js';
import { todayLocalIso } from '../../domain/records/seasons.js';
import { canReview } from '../../domain/records/workflow.js';
import { createRecord, updateRecord } from '../../lib/records.js';
import { recordsText } from './text.js';
import * as ui from './ui.js';
import { useFarmFields } from './farmFields.js';
import FieldPicker from './FieldPicker.jsx';
import Modal from './Modal.jsx';

const blank = (value) => value === undefined || value === null || String(value).trim() === '';

function Field({ field, lang, value, required, invalid, onChange, id, invalidText }) {
  const label = `${field.label[lang]}${required ? ' *' : ''}`;
  const errorId = `${id}-error`;
  const common = {
    id,
    value,
    onChange: (event) => onChange(event.target.value),
    'aria-required': required ? 'true' : undefined,
    'aria-invalid': invalid ? 'true' : undefined,
    'aria-describedby': invalid ? errorId : undefined,
    style: invalid ? ui.inputError : ui.input,
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={id} style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{label}</label>
      {field.type === 'select' ? (
        <select {...common}>
          <option value="" />
          {field.options.map((option) => <option key={option.value} value={option.value}>{option[lang]}</option>)}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea {...common} rows={3} style={{ ...common.style, resize: 'vertical' }} />
      ) : (
        <input {...common} type="text" inputMode={field.type === 'number' ? 'decimal' : undefined} />
      )}
      {invalid && <div id={errorId} style={{ color: '#b91c1c', fontSize: 11, marginTop: 3 }}>{invalidText}</div>}
    </div>
  );
}

/**
 * Create or edit a record of one kind (a new one can start from some `prefill` values). Fields come from the domain definition, so the
 * form, validation and storage can never disagree. What is still missing is shown live,
 * and who can submit what depends on the role (crew submit; owners/managers approve).
 */
export default function RecordForm({ kind, role, farmId, record, prefill, today, onSaved, onCancel }) {
  const { lang: rawLang } = useLanguage();
  const lang = rawLang === 'es' ? 'es' : 'en';
  const tt = recordsText(lang);
  const fields = KIND_FIELDS[kind];
  const isEdit = Boolean(record);
  // An existing record starts from its own values; a new one can start from some given (a new count of an item already counted).
  const startingPayload = record ? record.payload : prefill;
  // The farm's own list of fields to pick from (a plain box until it has an active field).
  const farmFields = useFarmFields().fields;
  const pickFromFarmFields = farmFields.some((f) => f.is_active);

  // Remember what the form started with, to tell whether the person has typed anything.
  const [initial] = useState(() => ({
    values: Object.fromEntries(fields.map((f) => [f.key, blank(startingPayload?.[f.key]) ? '' : String(startingPayload[f.key])])),
    // An existing record with no date stays without one; only a NEW record defaults to today.
    date: record ? record.record_date ?? '' : today ?? todayLocalIso(),
  }));
  const [values, setValues] = useState(initial.values);
  const [date, setDate] = useState(initial.date);
  const [submitting, setSubmitting] = useState(null);
  const [error, setError] = useState(null);

  const evaluation = useMemo(() => evaluateRecord(kind, { record_date: date, payload: values }), [kind, date, values]);
  const filled = useMemo(() => Object.fromEntries(Object.entries(values).filter(([, v]) => !blank(v))), [values]);
  const required = useMemo(() => new Set(requiredFieldKeys(kind, filled)), [kind, filled]);

  const labelOf = (key) => (key === 'record_date' ? tt.form.date : fields.find((f) => f.key === key)?.label[lang] ?? key);
  const hasErrors = !evaluation.ok;
  const busy = submitting !== null;

  async function save(status) {
    setSubmitting(status);
    setError(null);
    const result = isEdit
      ? await updateRecord(record.id, { kind, recordDate: date, payload: values })
      : await createRecord({ farmId, kind, recordDate: date, payload: values, status });
    setSubmitting(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved?.(result.data);
  }

  const dirty = date !== initial.date || fields.some((f) => values[f.key] !== initial.values[f.key]);

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm(tt.form.discard)) return;
    onCancel?.();
  }

  const reviewer = canReview(role);
  const kindLabel = KIND_META[kind].label[lang];
  const title = isEdit ? tt.form.editTitle(kindLabel) : tt.form.addTitle(kindLabel);

  return (
    <Modal title={title} onClose={requestClose} dismissible={!busy}>
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="rec-date" style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>{tt.form.date}</label>
        <input
          id="rec-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          aria-invalid={evaluation.errors.record_date ? 'true' : undefined}
          aria-describedby={evaluation.errors.record_date ? 'rec-date-error' : undefined}
          style={evaluation.errors.record_date ? ui.inputError : ui.input}
        />
        {evaluation.errors.record_date && <div id="rec-date-error" style={{ color: '#b91c1c', fontSize: 11, marginTop: 3 }}>{tt.field.invalid}</div>}
      </div>

      {fields.map((field) => field.key === 'field' && pickFromFarmFields ? (
        <FieldPicker
          key={field.key}
          id={`rec-${field.key}`}
          label={`${field.label[lang]}${required.has(field.key) ? ' *' : ''}`}
          fields={farmFields}
          value={values[field.key]}
          required={required.has(field.key)}
          invalid={Boolean(evaluation.errors[field.key])}
          invalidText={tt.field.invalid}
          onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
        />
      ) : (
        <Field
          key={field.key}
          id={`rec-${field.key}`}
          field={field}
          lang={lang}
          value={values[field.key]}
          required={required.has(field.key)}
          invalid={Boolean(evaluation.errors[field.key])}
          invalidText={tt.field.invalid}
          onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
        />
      ))}

      {!evaluation.complete && !hasErrors && evaluation.missing.length > 0 && (
        <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: '8px 12px', margin: '4px 0 14px' }}>
          {tt.form.missing} {evaluation.missing.map(labelOf).join(', ')}
        </p>
      )}

      {error && (
        <div role="alert" style={{ marginBottom: 14, padding: '9px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13 }}>
          {tt.errors[error.code] ?? tt.errors.unknown}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" onClick={requestClose} style={ui.buttonSecondary}>{tt.form.cancel}</button>
        {isEdit ? (
          <button type="button" disabled={hasErrors || busy} onClick={() => save(record.status)} style={{ ...ui.buttonPrimary, ...(hasErrors || busy ? ui.buttonDisabled : {}) }}>
            {busy ? tt.form.saving : tt.form.saveChanges}
          </button>
        ) : (
          <>
            <button type="button" disabled={hasErrors || busy} onClick={() => save('draft')} style={{ ...ui.buttonSecondary, ...(hasErrors || busy ? ui.buttonDisabled : {}) }}>
              {submitting === 'draft' ? tt.form.saving : tt.form.saveDraft}
            </button>
            <button
              type="button"
              disabled={!evaluation.complete || busy}
              onClick={() => save(reviewer ? 'approved' : 'pending_review')}
              style={{ ...(reviewer ? ui.buttonSuccess : ui.buttonPrimary), ...(!evaluation.complete || busy ? ui.buttonDisabled : {}) }}
            >
              {submitting === 'approved' || submitting === 'pending_review' ? tt.form.saving : reviewer ? tt.form.approve : tt.form.submit}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
