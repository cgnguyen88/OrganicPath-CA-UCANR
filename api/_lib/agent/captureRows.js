import { createHash } from 'node:crypto';
import { recordFingerprint } from '../../../src/domain/records/schemas.js';
import { questionsFor } from './followup.js';

export const CAPTURE_SOURCE = 'web_upload';
const CONFIDENCE_DECIMALS = 1000; // records.confidence is numeric(4,3)

/**
 * A stable key for one capture. Retrying the same message gives the same key, so a repeat is
 * recognized instead of paying for the model again and filing the records twice.
 *
 * The key is scoped to the sender and the farm's calendar day: the same words sent tomorrow
 * ("Irrigated block 4 yesterday") are a new event, and a teammate's identical photo is theirs to
 * file. `attempt` lets a message be filed again after every earlier capture of it was rejected
 * or voided (the (farm, source_ref) unique index would otherwise block it forever).
 *
 * @param {{ text: string, attachments: Array<{ source: { media_type: string, data: string } }>, userId: string, day: string, attempt?: number }} input
 * @returns {string} 64 hex characters
 */
export function captureHashOf({ text, attachments, userId, day, attempt = 0 }) {
  const hash = createHash('sha256');
  hash.update(`u:${userId}\0d:${day}\0n:${attempt}\0t:${text}\0`);
  for (const file of attachments) hash.update(`${file.source.media_type}:${file.source.data}\0`);
  return hash.digest('hex');
}

const roundConfidence = (value) => (typeof value === 'number' ? Math.round(value * CONFIDENCE_DECIMALS) / CONFIDENCE_DECIMALS : null);

/**
 * Turn validated proposals into database rows. Everything that decides ownership, tenancy and
 * trust (farm, author, source, status) is set here from the authenticated session, never from
 * the request. Nothing is ever created approved: a person reviews every record.
 *
 * `attachments` is the manifest of stored source files, shared by every record read from them.
 * `source` says which way in the message came (web_upload, telegram, ...).
 *
 * @returns {Array<Record<string, unknown>>}
 */
export function buildCaptureRows({ proposals, farmId, userId, captureHash, attachments = [], source = CAPTURE_SOURCE }) {
  return proposals.map((proposal, index) => ({
    farm_id: farmId,
    created_by: userId,
    kind: proposal.kind,
    status: proposal.complete ? 'pending_review' : 'needs_info',
    record_date: proposal.record_date,
    payload: proposal.payload,
    missing_fields: proposal.missing,
    confidence: roundConfidence(proposal.confidence),
    fingerprint: recordFingerprint(proposal.kind, proposal.record_date, proposal.payload),
    source,
    source_ref: `${captureHash}#${index}`,
    attachments,
  }));
}

/**
 * The client-facing shape of a saved record: no authorship or provenance columns, plus the
 * follow-up questions for whatever is still missing.
 */
export function presentRecord(row, lang) {
  const missing = row.missing_fields ?? [];
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    record_date: row.record_date ?? null,
    payload: row.payload ?? {},
    missing_fields: missing,
    confidence: row.confidence ?? null,
    version: row.version,
    attachments: row.attachments ?? [],
    questions: questionsFor(row.kind, missing, lang),
  };
}

/** Today's calendar date (YYYY-MM-DD) in the given IANA time zone. */
export function farmToday(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * The columns a reply may write, from the re-validated record. A complete record goes to review;
 * an incomplete one keeps waiting for details. Nothing here can approve anything.
 *
 * @param {string} kind
 * @param {{ complete: boolean, missing: string[], value: { record_date: string | null, payload: object } }} evaluation
 */
export function buildReplyPatch(kind, evaluation) {
  const { record_date: recordDate, payload } = evaluation.value;
  return {
    record_date: recordDate,
    payload,
    status: evaluation.complete ? 'pending_review' : 'needs_info',
    missing_fields: evaluation.missing,
    fingerprint: recordFingerprint(kind, recordDate, payload),
  };
}
