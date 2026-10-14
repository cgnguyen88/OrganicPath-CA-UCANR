import { supabase } from './supabase.js';
import { fieldKey, validateFieldInput } from '../domain/records/fields.js';

/**
 * Data access for a farm's fields. Every function resolves to `{ data, error }` and never throws: `error` is
 * `{ code, message?, fields? }` with a code the screen can explain: invalid · forbidden · duplicate · in_use · too_many · not_set_up · unknown.
 * Writes are validated here first; the database enforces the same rules, including that a field used by
 * records cannot be renamed or deleted.
 */

export const MAX_FIELDS_AT_ONCE = 50;

const fail = (code, extra = {}) => ({ data: null, error: { code, ...extra } });
const done = (data) => ({ data, error: null });

/** @param {{ code?: string, message?: string } | null | undefined} dbError */
export function describeFieldError(dbError) {
  const message = dbError?.message;
  switch (dbError?.code) {
    case '42501':
    case 'PGRST116': // a single-row update matched nothing: row-level security hid it
      return { code: 'forbidden', message };
    case 'PGRST205': // the table is not in the API's schema: the database update that creates it has not been applied
    case '42P01':
      return { code: 'not_set_up', message };
    case '23505':
      return { code: 'duplicate', message };
    case '23514':
      return { code: /used by records/i.test(message ?? '') ? 'in_use' : /at most \d+ fields/i.test(message ?? '') ? 'too_many' : 'invalid', message };
    default:
      return { code: 'unknown', message };
  }
}

function fromDb({ data, error }) {
  if (error) {
    const described = describeFieldError(error);
    if (described.code === 'unknown') console.error('fields:', error);
    return { data: null, error: described };
  }
  return done(data ?? null);
}

/** A farm's fields: those in use first, then by name. @param {string} farmId */
export async function listFields(farmId) {
  if (typeof farmId !== 'string' || farmId === '') return fail('invalid');
  const result = fromDb(await supabase.from('fields').select('*').eq('farm_id', farmId).order('is_active', { ascending: false }).order('name', { ascending: true }));
  return result.error ? result : done(result.data ?? []);
}

/** @param {{ farmId: string, name?: unknown, area?: unknown, area_unit?: unknown, notes?: unknown }} input */
export async function createField({ farmId, ...input }) {
  if (typeof farmId !== 'string' || farmId === '') return fail('invalid');
  const checked = validateFieldInput(input);
  if (!checked.ok) return fail('invalid', { fields: checked.errors });
  return fromDb(await supabase.from('fields').insert({ farm_id: farmId, ...checked.value }).select().single());
}

/** Change a field's name, area or notes. (Its farm and author never change; archiving is `setFieldActive`.) */
export async function updateField(id, input) {
  const checked = validateFieldInput(input);
  if (!checked.ok) return fail('invalid', { fields: checked.errors });
  return fromDb(await supabase.from('fields').update(checked.value).eq('id', id).select().single());
}

/** Archive (false) or restore (true) a field. Archived fields stay in the records that use them. */
export async function setFieldActive(id, active) {
  if (typeof active !== 'boolean') return fail('invalid');
  return fromDb(await supabase.from('fields').update({ is_active: active }).eq('id', id).select().single());
}

/** Delete a field no record uses. Row-level security reports a forbidden delete as "nothing deleted". */
export async function deleteField(id) {
  const { data, error } = await supabase.from('fields').delete().eq('id', id).select('id');
  if (error) return fromDb({ data: null, error });
  if (Array.isArray(data) && data.length === 0) return fail('forbidden');
  return done(null);
}

/**
 * Add several fields by name, one at a time, so one that already exists or is not a valid name does not stop
 * the rest. Stops at once if the person may not add fields, or on an unexpected failure.
 *
 * @param {string} farmId
 * @param {string[]} names
 * @returns {Promise<{ data: { added: number, skipped: number, remaining: number } | null, error: object | null }>} `remaining` is how many names were left for another go
 */
export async function addFieldsByName(farmId, names) {
  if (typeof farmId !== 'string' || farmId === '') return fail('invalid');
  const seen = new Set();
  const unique = [];
  let skipped = 0;
  for (const name of names) {
    const key = fieldKey(name);
    if (key !== '' && seen.has(key)) skipped += 1;
    else {
      seen.add(key);
      unique.push(name);
    }
  }

  let added = 0;
  const batch = unique.slice(0, MAX_FIELDS_AT_ONCE);
  for (const name of batch) {
    const checked = validateFieldInput({ name });
    if (!checked.ok) {
      skipped += 1;
      continue;
    }
    const { error } = fromDb(await supabase.from('fields').insert({ farm_id: farmId, ...checked.value }));
    if (!error) added += 1;
    else if (error.code === 'duplicate' || error.code === 'invalid') skipped += 1;
    else return fail(error.code, { message: error.message, added });
  }
  return done({ added, skipped, remaining: unique.length - batch.length });
}
