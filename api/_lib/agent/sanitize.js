import { evaluateRecord } from '../../../src/domain/records/schemas.js';

/**
 * The single place that decides what survives from a model's tool call. The model is trusted
 * with nothing: every value goes through the same validation the form uses, anything invalid
 * is dropped (and so counts as "missing" and gets asked about), and nulls simply mean "not
 * present".
 */

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Remove null / undefined / empty-string entries ("not present"). */
export const withoutBlank = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined && v !== ''));

/** @param {unknown} value @returns {number | null} */
export function clampConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * @param {string} kind
 * @param {unknown} input a tool call's arguments
 * @returns {{ record_date: string | null, payload: Record<string, unknown>, missing: string[], dropped: string[], complete: boolean } | null}
 *   null when there is nothing usable (not an object, or nothing filled in)
 */
export function sanitizeProposal(kind, input) {
  if (!isObject(input) || !isObject(input.payload)) return null;

  const payload = withoutBlank(input.payload);
  if (Object.keys(payload).length === 0) return null;
  const rawDate = typeof input.record_date === 'string' && input.record_date.trim() ? input.record_date.trim() : undefined;

  let evaluation = evaluateRecord(kind, { record_date: rawDate, payload });
  const dropped = [];

  if (!evaluation.ok) {
    const cleaned = { ...payload };
    let date = rawDate;
    for (const key of Object.keys(evaluation.errors)) {
      if (key === 'record_date') date = undefined;
      else delete cleaned[key];
      dropped.push(key);
    }
    if (Object.keys(cleaned).length === 0) return null;
    evaluation = evaluateRecord(kind, { record_date: date, payload: cleaned });
  }
  if (!evaluation.ok) return null;

  return {
    record_date: evaluation.value.record_date,
    payload: evaluation.value.payload,
    missing: evaluation.missing,
    dropped,
    complete: evaluation.complete,
  };
}
