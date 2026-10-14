import { useMemo } from 'react';
import { summarizeMaterials } from '../../domain/records/materials.js';
import { monthsBefore } from '../../domain/records/seasons.js';
import useFarmRecords from '../records/useFarmRecords.js';

/** The date a year before `today`, for "what was used this certification year". @param {string} today YYYY-MM-DD */
export const materialsSince = (today) => monthsBefore(today, 12);

/**
 * The materials a farm uses, from its approved records: what was bought, applied or sprayed since `from`,
 * plus everything on its Input List (those have no dates, so they are read in full).
 *
 * @param {string | undefined} farmId
 * @param {string} from YYYY-MM-DD
 * @returns {{ status: 'loading' | 'ready' | 'error', materials: ReturnType<typeof summarizeMaterials>, records: object[], truncated: boolean, reload: () => void }}
 */
export default function useFarmMaterials(farmId, from) {
  const dated = useFarmRecords({ farmId, kinds: ['purchase', 'amendment', 'activity'], from });
  const inputs = useFarmRecords({ farmId, kinds: ['input'] });

  const status = dated.status === 'error' || inputs.status === 'error' ? 'error' : dated.status === 'loading' || inputs.status === 'loading' ? 'loading' : 'ready';
  const records = useMemo(() => (status === 'ready' ? [...dated.records, ...inputs.records] : []), [status, dated.records, inputs.records]);
  const materials = useMemo(() => summarizeMaterials(records), [records]);

  return {
    status,
    materials,
    records,
    truncated: dated.truncated || inputs.truncated,
    reload: () => {
      dated.reload();
      inputs.reload();
    },
  };
}
