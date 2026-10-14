import { useEffect, useEffectEvent, useState } from 'react';
import { listRecordsForReport } from '../../lib/reportData.js';

const LOADING = { key: null, status: 'loading', records: [], truncated: false };

/**
 * A farm's approved records of some kinds, from a date on, read the way an export reads them (every page,
 * up to a limit, as the signed-in person). For tools that work from the farm's records: the materials
 * list, record coverage, inventory.
 *
 * It reads again only when what it is asked for really changes (not when a parent re-renders), shows
 * "loading" with no records while it does, and ignores an answer that arrives late for something it is no
 * longer asking about. A farm that does not exist yet has no records and nothing to read.
 *
 * @param {{ farmId?: string, kinds?: string[], from?: string }} options
 * @returns {{ status: 'loading' | 'ready' | 'error', records: object[], truncated: boolean, reload: () => void }}
 */
export default function useFarmRecords({ farmId, kinds, from }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(LOADING);
  // What is asked for. Reading again (`attempt`) is not a different question, so a read that worked keeps its records on screen meanwhile.
  const key = `${farmId ?? ''}|${(kinds ?? []).join(',')}|${from ?? ''}`;

  const read = useEffectEvent(() => listRecordsForReport({ farmId, kinds, from, includeUnapproved: false }));
  useEffect(() => {
    if (!farmId) return undefined;
    let alive = true;
    const finish = (value) => {
      if (alive) setLoaded({ key, attempt, ...value });
    };
    read().then(
      ({ data, error }) => finish(error ? { status: 'error', records: [], truncated: false } : { status: 'ready', records: data.records, truncated: data.truncated }),
      (error) => {
        console.error('farm records:', error);
        finish({ status: 'error', records: [], truncated: false });
      },
    );
    return () => { alive = false; };
  }, [key, farmId, attempt]);

  // A retry after a failure has nothing to keep on screen, so it shows loading again.
  const retrying = loaded.status === 'error' && loaded.attempt !== attempt;
  const current = !farmId ? { status: 'ready', records: [], truncated: false } : loaded.key === key && !retrying ? loaded : LOADING;
  return { status: current.status, records: current.records, truncated: current.truncated, reload: () => setAttempt((n) => n + 1) };
}
