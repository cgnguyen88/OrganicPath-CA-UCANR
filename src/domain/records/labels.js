import { KIND_FIELDS } from './kinds.js';

/**
 * The human label of a record field in the person's language, for messages like "Updated: Product".
 * `record_date` has no entry in KIND_FIELDS, so its label is passed in by the caller.
 *
 * @param {string} kind
 * @param {string} key a payload key, or 'record_date'
 * @param {'en' | 'es'} lang
 * @param {string} dateLabel
 */
export function fieldLabel(kind, key, lang, dateLabel) {
  if (key === 'record_date') return dateLabel;
  return KIND_FIELDS[kind]?.find((field) => field.key === key)?.label[lang] ?? key;
}
