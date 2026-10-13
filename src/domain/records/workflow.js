/**
 * Who may do what to a record. This mirrors the rules the database enforces (see
 * supabase/migrations/…_records.sql); a test runs every transition against the real
 * database rules to keep the two in agreement. The UI uses it to show only the actions
 * that will actually succeed.
 */

const REVIEWER_ROLES = ['owner', 'manager'];
const EDITABLE_BY_AUTHOR = ['draft', 'needs_info', 'pending_review'];

/** Transitions owners/managers may make. voided is final. */
const REVIEWER_TRANSITIONS = Object.freeze({
  draft: ['needs_info', 'pending_review', 'voided'],
  needs_info: ['draft', 'pending_review', 'voided'],
  pending_review: ['approved', 'rejected', 'needs_info', 'voided'],
  approved: ['voided'],
  rejected: ['pending_review', 'voided'],
  voided: [],
});

/** Transitions crew may make on their own unreviewed records: toward review, never final decisions. */
const CREW_TRANSITIONS = Object.freeze({
  draft: ['needs_info', 'pending_review'],
  needs_info: ['draft', 'pending_review'],
  pending_review: ['needs_info'],
  approved: [],
  rejected: [],
  voided: [],
});

/** @param {string | null | undefined} role */
export const canReview = (role) => REVIEWER_ROLES.includes(role);

/**
 * @param {string} status
 * @param {string | null | undefined} role
 * @returns {string[]}
 */
export function allowedTransitions(status, role) {
  if (canReview(role)) return [...(REVIEWER_TRANSITIONS[status] ?? [])];
  if (role === 'crew') return [...(CREW_TRANSITIONS[status] ?? [])];
  return [];
}

/**
 * The status changes to OFFER this person on this record: everything allowed for owners and
 * managers; for crew only sending their own unreviewed record on to review. (The database
 * enforces the same rules; offering only what will succeed avoids dead-end buttons.)
 *
 * @param {{ status: string, created_by?: string | null }} record
 * @param {string | null | undefined} role
 * @param {string | null | undefined} userId
 * @returns {string[]}
 */
export function availableActions(record, role, userId) {
  if (canReview(role)) return allowedTransitions(record.status, role);
  if (role === 'crew' && userId && record.created_by === userId) {
    return allowedTransitions(record.status, 'crew').filter((status) => status === 'pending_review');
  }
  return [];
}

/**
 * @param {{ status: string, created_by?: string | null }} record
 * @param {string | null | undefined} role
 * @param {string | null | undefined} userId
 */
export function canEditRecord(record, role, userId) {
  if (!role || !userId) return false;
  if (record.status === 'voided') return false;
  if (canReview(role)) return true;
  return role === 'crew' && record.created_by === userId && EDITABLE_BY_AUTHOR.includes(record.status);
}

/** Visual tone per status (the UI maps tones to colors). */
export const STATUS_TONE = Object.freeze({
  draft: 'neutral',
  needs_info: 'warning',
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  voided: 'muted',
});
