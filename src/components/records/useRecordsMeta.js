import { useCallback, useEffect, useState } from 'react';
import { countNeedsReview, getMyRole, listSavedViews } from '../../lib/records.js';

const EMPTY = Object.freeze({ role: null, savedViews: [], needsReviewCount: 0 });

/**
 * What the sidebar and records screens need to know about the signed-in person's farm:
 * their role, the farm's saved views, and how many records await review. `refresh`
 * re-reads the views and the count (call it after anything that changes them).
 *
 * @param {{ farm: { id: string } | null, userId: string | null | undefined }} args
 */
export default function useRecordsMeta({ farm, userId }) {
  const farmId = farm?.id;
  const key = farmId && userId ? `${farmId}:${userId}` : null;

  // Results are tagged with the farm/user they were loaded for, so signing out (or
  // switching farm) shows defaults immediately without resetting state inside an effect.
  const [loaded, setLoaded] = useState({ key: null, ...EMPTY });
  const meta = key && loaded.key === key ? loaded : EMPTY;

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    Promise.all([getMyRole(farmId, userId), listSavedViews(farmId), countNeedsReview(farmId)]).then(([role, views, count]) => {
      if (alive) setLoaded({ key, role, savedViews: views.data ?? [], needsReviewCount: count.data ?? 0 });
    });
    return () => { alive = false; };
  }, [key, farmId, userId]);

  const refresh = useCallback(async () => {
    if (!key) return;
    const [views, count] = await Promise.all([listSavedViews(farmId), countNeedsReview(farmId)]);
    // Apply only if we are still looking at the farm/user this refresh was for.
    setLoaded((current) => (current.key !== key ? current : { ...current, savedViews: views.data ?? current.savedViews, needsReviewCount: count.data ?? current.needsReviewCount }));
  }, [key, farmId]);

  return { role: meta.role, savedViews: meta.savedViews, needsReviewCount: meta.needsReviewCount, ready: Boolean(key && loaded.key === key), refresh };
}
