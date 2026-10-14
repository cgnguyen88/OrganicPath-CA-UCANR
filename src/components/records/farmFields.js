import { createContext, useContext, useEffect, useEffectEvent, useState } from 'react';
import { listFields } from '../../lib/fields.js';

const NO_FIELDS = Object.freeze([]);
const LOADING = Object.freeze({ farmId: null, status: 'loading', fields: NO_FIELDS, errorCode: null });
const NOTHING_TO_READ = Object.freeze({ status: 'ready', fields: NO_FIELDS, errorCode: null });

/** What a form or a record sees outside a provider: an empty list that is ready, so it works without one. */
export const FarmFieldsContext = createContext({ ...NOTHING_TO_READ, reload: () => {} });

/** The signed-in farm's field list: `{ status: 'loading' | 'ready' | 'error', fields, reload }`. */
export const useFarmFields = () => useContext(FarmFieldsContext);

/**
 * Reads a farm's fields (those in use first, then by name). It reads again only when the farm changes or
 * `reload` is called, shows "loading" with no fields as soon as the farm changes (never another farm's
 * list), keeps showing the list it has while it reads again, and ignores an answer that arrives late for a
 * farm it is no longer asking about. A farm that does not exist yet has no fields and nothing to read.
 *
 * @param {string | undefined} farmId
 * @returns {{ status: 'loading' | 'ready' | 'error', fields: object[], errorCode: string | null, reload: () => void }} `errorCode` says why a read failed (see `describeFieldError`)
 */
export function useLoadFarmFields(farmId) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(LOADING);

  const read = useEffectEvent(() => listFields(farmId));
  useEffect(() => {
    if (!farmId) return undefined;
    let alive = true;
    // A failed read keeps the list this farm already had (a failed reload must not empty the screen).
    const finish = (result) => {
      if (!alive) return;
      setLoaded((current) => {
        const had = current.farmId === farmId ? current.fields : NO_FIELDS;
        return result.error ? { farmId, status: 'error', fields: had, errorCode: result.error.code ?? 'unknown' } : { farmId, status: 'ready', fields: result.data, errorCode: null };
      });
    };
    read().then(finish, (error) => {
      console.error('farm fields:', error);
      finish({ error });
    });
    return () => { alive = false; };
  }, [farmId, attempt]);

  const current = !farmId ? NOTHING_TO_READ : loaded.farmId === farmId ? loaded : LOADING;
  return { status: current.status, fields: current.fields, errorCode: current.errorCode, reload: () => setAttempt((n) => n + 1) };
}
