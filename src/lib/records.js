import { supabase } from './supabase.js';
import { RECORD_STATUSES } from '../domain/records/kinds.js';
import { evaluateRecord, recordFingerprint } from '../domain/records/schemas.js';
import { parseViewFilter, applyFilterToQuery } from '../domain/records/savedViews.js';

/**
 * Data access for farm records, their history and saved views. Every function resolves to
 * `{ data, error }` (never throws): `error` is `{ code, message?, missing?, fields? }` with a
 * code the UI can explain: invalid · incomplete · forbidden · duplicate · invalid_transition ·
 * voided · unknown. Writes are validated here first; the database enforces the same rules.
 */

export const RECORD_LIST_LIMIT = 500;
/** Statuses a new record may be created with (the rest are reached through review). */
const CREATABLE_STATUSES = ['draft', 'needs_info', 'pending_review', 'approved'];
const NEEDS_COMPLETE = ['pending_review', 'approved'];
const VISIBLE_STATUSES = RECORD_STATUSES.filter((s) => s !== 'voided');
const MAX_VIEW_NAME = 80;

const fail = (code, extra = {}) => ({ data: null, error: { code, ...extra } });
const done = (data) => ({ data, error: null });

/**
 * Translate a Postgres/PostgREST error into a UI-friendly code.
 * @param {{ code?: string, message?: string } | null | undefined} dbError
 * @returns {{ code: string, message?: string }}
 */
export function describeRecordError(dbError) {
  const message = dbError?.message;
  switch (dbError?.code) {
    case '42501':
    case 'PGRST116': // a single-row update/select matched nothing: row-level security hid it
      return { code: 'forbidden', message };
    case '23505':
      return { code: 'duplicate', message };
    case '23514':
      if (/incomplete/i.test(message ?? '')) return { code: 'incomplete', message };
      if (/invalid status change/i.test(message ?? '')) return { code: 'invalid_transition', message };
      if (/voided/i.test(message ?? '')) return { code: 'voided', message };
      return { code: 'invalid', message };
    default:
      return { code: 'unknown', message };
  }
}

function fromDb({ data, error }, table) {
  if (error) {
    const described = describeRecordError(error);
    if (described.code === 'unknown') console.error(`${table}:`, error);
    return { data: null, error: described };
  }
  return done(data ?? null);
}

// ─── Records ────────────────────────────────────────────────────────────────

/**
 * `source` and `source_ref` (where a record came from, and its de-duplication key) are set by the
 * server paths that ingest records, never by a client, so they are not accepted here.
 *
 * @param {{ farmId: string, kind: string, recordDate?: string, payload?: object, status?: string,
 *   attachments?: object[], confidence?: number }} input
 */
export async function createRecord({ farmId, kind, recordDate, payload, status = 'pending_review', attachments, confidence }) {
  if (!CREATABLE_STATUSES.includes(status)) return fail('invalid', { fields: { status: 'invalid' } });

  const evaluation = evaluateRecord(kind, { record_date: recordDate, payload });
  if (!evaluation.ok) return fail('invalid', { fields: evaluation.errors });
  if (NEEDS_COMPLETE.includes(status) && !evaluation.complete) return fail('incomplete', { missing: evaluation.missing });

  const { record_date, payload: cleanPayload } = evaluation.value;
  const row = {
    farm_id: farmId,
    kind,
    status,
    record_date,
    payload: cleanPayload,
    missing_fields: evaluation.missing,
    fingerprint: recordFingerprint(kind, record_date, cleanPayload),
    attachments: attachments ?? [],
    confidence: confidence ?? null,
  };
  return fromDb(await supabase.from('records').insert(row).select().single(), 'createRecord');
}

/**
 * Edit a record's content. Status changes go through setRecordStatus.
 * @param {string} id
 * @param {{ kind: string, recordDate?: string, payload?: object, attachments?: object[], confidence?: number }} input
 */
export async function updateRecord(id, { kind, recordDate, payload, attachments, confidence }) {
  const evaluation = evaluateRecord(kind, { record_date: recordDate, payload });
  if (!evaluation.ok) return fail('invalid', { fields: evaluation.errors });

  const { record_date, payload: cleanPayload } = evaluation.value;
  const patch = {
    record_date,
    payload: cleanPayload,
    missing_fields: evaluation.missing,
    fingerprint: recordFingerprint(kind, record_date, cleanPayload),
    ...(attachments !== undefined ? { attachments } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
  return fromDb(await supabase.from('records').update(patch).eq('id', id).select().single(), 'updateRecord');
}

/** @param {string} id @param {string} status */
export async function setRecordStatus(id, status) {
  if (!RECORD_STATUSES.includes(status)) return fail('invalid', { fields: { status: 'invalid' } });
  return fromDb(await supabase.from('records').update({ status }).eq('id', id).select().single(), 'setRecordStatus');
}

const newestFirst = (q) => q.order('record_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });

/**
 * @param {{ farmId: string, kind?: string, statuses?: string[], limit?: number }} options
 */
export async function listRecords({ farmId, kind, statuses = VISIBLE_STATUSES, limit = RECORD_LIST_LIMIT }) {
  let q = supabase.from('records').select('*').eq('farm_id', farmId);
  if (kind) q = q.eq('kind', kind);
  q = newestFirst(q.in('status', statuses)).limit(limit);
  return fromDb(await q, 'listRecords');
}

/**
 * Run a saved view. A stored filter that does not parse is refused rather than guessed at.
 * @param {{ filter: unknown }} view
 * @param {{ farm: { id: string, season_start_month?: number, season_start_day?: number }, today: string | Date }} ctx
 */
export async function listSavedViewRecords(view, ctx, limit = RECORD_LIST_LIMIT) {
  const parsed = parseViewFilter(view.filter);
  if (!parsed.ok) return fail('invalid', { message: parsed.error });
  const q = applyFilterToQuery(supabase.from('records').select('*').eq('farm_id', ctx.farm.id), parsed.value, ctx);
  return fromDb(await newestFirst(q).limit(limit), 'listSavedViewRecords');
}

/** Number of records waiting for an owner/manager. @param {string} farmId */
export async function countNeedsReview(farmId) {
  const { count, error } = await supabase
    .from('records')
    .select('id', { count: 'exact', head: true })
    .eq('farm_id', farmId)
    .eq('status', 'pending_review');
  if (error) return fromDb({ data: null, error }, 'countNeedsReview');
  return done(count ?? 0);
}

/**
 * Change history, oldest first for one record, newest first for the whole farm.
 * @param {{ farmId: string, recordId?: string, limit?: number }} options
 */
export async function listRevisions({ farmId, recordId, limit = RECORD_LIST_LIMIT }) {
  let q = supabase.from('record_revisions').select('*').eq('farm_id', farmId);
  q = recordId ? q.eq('record_id', recordId).order('version', { ascending: true }) : q.order('changed_at', { ascending: false });
  return fromDb(await q.limit(limit), 'listRevisions');
}

// ─── Saved views ────────────────────────────────────────────────────────────

/** A farm's views in display order; any whose stored filter no longer parses are left out. @param {string} farmId */
export async function listSavedViews(farmId) {
  const result = fromDb(await supabase.from('saved_views').select('*').eq('farm_id', farmId).order('position', { ascending: true }), 'listSavedViews');
  if (result.error) return result;
  const views = [];
  for (const view of result.data ?? []) {
    const parsed = parseViewFilter(view.filter);
    if (parsed.ok) views.push({ ...view, filter: parsed.value });
  }
  return done(views);
}

const cleanName = (name) => (typeof name === 'string' ? name.trim() : '');

/** @param {{ farmId: string, name: string, filter: unknown, pinned?: boolean, position?: number }} input */
export async function createSavedView({ farmId, name, filter, pinned, position }) {
  const trimmed = cleanName(name);
  if (trimmed.length < 1 || trimmed.length > MAX_VIEW_NAME) return fail('invalid', { fields: { name: 'invalid' } });
  const parsed = parseViewFilter(filter);
  if (!parsed.ok) return fail('invalid', { fields: { filter: 'invalid' } });

  const row = {
    farm_id: farmId,
    name: trimmed,
    filter: parsed.value,
    ...(pinned !== undefined ? { pinned } : {}),
    ...(position !== undefined ? { position } : {}),
  };
  return fromDb(await supabase.from('saved_views').insert(row).select().single(), 'createSavedView');
}

/** @param {string} id @param {{ name?: string, filter?: unknown, pinned?: boolean, position?: number }} changes */
export async function updateSavedView(id, { name, filter, pinned, position }) {
  const patch = {};
  if (name !== undefined) {
    const trimmed = cleanName(name);
    if (trimmed.length < 1 || trimmed.length > MAX_VIEW_NAME) return fail('invalid', { fields: { name: 'invalid' } });
    patch.name = trimmed;
  }
  if (filter !== undefined) {
    const parsed = parseViewFilter(filter);
    if (!parsed.ok) return fail('invalid', { fields: { filter: 'invalid' } });
    patch.filter = parsed.value;
  }
  if (pinned !== undefined) patch.pinned = pinned;
  if (position !== undefined) patch.position = position;
  return fromDb(await supabase.from('saved_views').update(patch).eq('id', id).select().single(), 'updateSavedView');
}

/** Default views cannot be deleted; row-level security reports that as "nothing deleted". @param {string} id */
export async function deleteSavedView(id) {
  const { data, error } = await supabase.from('saved_views').delete().eq('id', id).select('id');
  if (error) return fromDb({ data: null, error }, 'deleteSavedView');
  if (Array.isArray(data) && data.length === 0) return fail('forbidden');
  return done(null);
}

// ─── Role ───────────────────────────────────────────────────────────────────

/** The caller's role in a farm ('owner' | 'manager' | 'crew'), or null. */
export async function getMyRole(farmId, userId) {
  if (!farmId || !userId) return null;
  const { data, error } = await supabase.from('farm_members').select('role').eq('farm_id', farmId).eq('user_id', userId).maybeSingle();
  if (error) {
    console.error('getMyRole:', error);
    return null;
  }
  return data?.role ?? null;
}
