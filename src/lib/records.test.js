import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable stand-in for a supabase-js query: records every call, resolves to `result` when awaited.
function chain(result) {
  const calls = [];
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      if (prop === 'calls') return calls;
      return (...args) => { calls.push([prop, ...args]); return proxy; };
    },
  });
  return proxy;
}
const from = vi.fn();
vi.mock('./supabase.js', () => ({ supabase: { from: (...a) => from(...a) } }));

const {
  createRecord, updateRecord, setRecordStatus, listRecords, listSavedViewRecords, countNeedsReview,
  listRevisions, listSavedViews, createSavedView, updateSavedView, deleteSavedView, getMyRole, describeRecordError,
} = await import('./records.js');

const FARM = { id: 'farm-1', season_start_month: 1, season_start_day: 1 };
const callNames = (q) => q.calls.map((c) => c[0]);
const callArgs = (q, name) => q.calls.find((c) => c[0] === name)?.slice(1);

beforeEach(() => {
  from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createRecord', () => {
  const base = { farmId: 'farm-1', kind: 'harvest', recordDate: '2026-10-01', payload: { crop: ' Lettuce ', field: 'B4', quantity: '12', unit: 'lb', junk: 'x' } };

  it('validates and normalizes, then inserts only server-writable columns', async () => {
    const q = chain({ data: { id: 'r1' }, error: null });
    from.mockReturnValue(q);
    const result = await createRecord({ ...base, status: 'pending_review' });

    expect(result).toEqual({ data: { id: 'r1' }, error: null });
    expect(from).toHaveBeenCalledWith('records');
    const [row] = callArgs(q, 'insert');
    expect(row).toMatchObject({
      farm_id: 'farm-1', kind: 'harvest', status: 'pending_review', record_date: '2026-10-01',
      payload: { crop: 'Lettuce', field: 'B4', quantity: 12, unit: 'lb' }, missing_fields: [],
    });
    expect(row.fingerprint).toMatch(/^harvest\|2026-10-01\|/);
    for (const forbidden of ['id', 'created_by', 'version', 'reviewed_by', 'reviewed_at', 'created_at']) expect(row).not.toHaveProperty(forbidden);
  });

  it('never sends provenance (source, source_ref): only the server decides where a record came from', async () => {
    const q = chain({ data: { id: 'r1' }, error: null });
    from.mockReturnValue(q);
    await createRecord({ ...base, status: 'pending_review', source: 'telegram', sourceRef: 'receipt:abc' });
    const [row] = callArgs(q, 'insert');
    expect(row).not.toHaveProperty('source');
    expect(row).not.toHaveProperty('source_ref');
  });

  it('stores what is still missing when saving a draft, without calling it an error', async () => {
    const q = chain({ data: { id: 'r2' }, error: null });
    from.mockReturnValue(q);
    await createRecord({ farmId: 'farm-1', kind: 'harvest', payload: { crop: 'Lettuce' }, status: 'draft' });
    expect(callArgs(q, 'insert')[0]).toMatchObject({ status: 'draft', missing_fields: ['record_date', 'field', 'quantity', 'unit'], record_date: null });
  });

  it.each(['pending_review', 'approved'])('refuses an incomplete record for %s, naming what is missing, without calling the database', async (status) => {
    const result = await createRecord({ farmId: 'farm-1', kind: 'harvest', payload: { crop: 'Lettuce' }, status });
    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: 'incomplete', missing: ['record_date', 'field', 'quantity', 'unit'] });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses invalid data without calling the database', async () => {
    const result = await createRecord({ ...base, payload: { ...base.payload, quantity: 'lots' }, status: 'pending_review' });
    expect(result.error).toMatchObject({ code: 'invalid', fields: { quantity: 'invalid' } });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses an unknown kind or status', async () => {
    expect((await createRecord({ ...base, kind: 'bogus', status: 'draft' })).error.code).toBe('invalid');
    expect((await createRecord({ ...base, status: 'archived' })).error.code).toBe('invalid');
  });

  it('turns database errors into codes the UI can explain', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }));
    expect((await createRecord({ ...base, status: 'approved' })).error).toMatchObject({ code: 'forbidden' });
  });
});

describe('updateRecord', () => {
  it('re-validates the whole payload and refreshes missing_fields', async () => {
    const q = chain({ data: { id: 'r1' }, error: null });
    from.mockReturnValue(q);
    await updateRecord('r1', { kind: 'activity', recordDate: '2026-10-01', payload: { activity_type: 'spray', field: 'B4', product: 'Bt' } });
    expect(callArgs(q, 'update')[0]).toMatchObject({ missing_fields: ['rate', 'target'], payload: { activity_type: 'spray', field: 'B4', product: 'Bt' } });
    expect(callArgs(q, 'eq')).toEqual(['id', 'r1']);
  });

  it('never sends columns the client may not write', async () => {
    const q = chain({ data: {}, error: null });
    from.mockReturnValue(q);
    await updateRecord('r1', { kind: 'note', recordDate: '2026-10-01', payload: { text: 'x' }, farm_id: 'evil', created_by: 'evil', version: 9 });
    const patch = callArgs(q, 'update')[0];
    expect(Object.keys(patch).sort()).toEqual(['attachments', 'confidence', 'fingerprint', 'missing_fields', 'payload', 'record_date'].filter((k) => k in patch).sort());
    for (const forbidden of ['farm_id', 'created_by', 'version', 'status']) expect(patch).not.toHaveProperty(forbidden);
  });
});

describe('setRecordStatus', () => {
  it('changes only the status', async () => {
    const q = chain({ data: { id: 'r1', status: 'approved' }, error: null });
    from.mockReturnValue(q);
    const result = await setRecordStatus('r1', 'approved');
    expect(callArgs(q, 'update')).toEqual([{ status: 'approved' }]);
    expect(result.data.status).toBe('approved');
  });

  it('rejects an unknown status locally', async () => {
    expect((await setRecordStatus('r1', 'archived')).error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });

  it('reports "not allowed" when row-level security matched no row (e.g. crew approving)', async () => {
    from.mockReturnValue(chain({ data: null, error: { code: 'PGRST116', message: 'The result contains 0 rows' } }));
    expect((await setRecordStatus('r1', 'approved')).error.code).toBe('forbidden');
  });
});

describe('describeRecordError', () => {
  it.each([
    [{ code: '42501', message: 'x' }, 'forbidden'],
    [{ code: 'PGRST116', message: 'x' }, 'forbidden'],
    [{ code: '23505', message: 'x' }, 'duplicate'],
    [{ code: '23514', message: 'Record is incomplete: missing field' }, 'incomplete'],
    [{ code: '23514', message: 'Invalid status change: approved -> pending_review' }, 'invalid_transition'],
    [{ code: '23514', message: 'Voided records cannot be changed' }, 'voided'],
    [{ code: '23514', message: 'something else' }, 'invalid'],
    [{ code: 'XX000', message: 'boom' }, 'unknown'],
    [null, 'unknown'],
  ])('maps %j to %s', (dbError, code) => {
    expect(describeRecordError(dbError).code).toBe(code);
  });
});

describe('listing', () => {
  it('lists one kind newest first, scoped to the farm, excluding withdrawn records by default', async () => {
    const q = chain({ data: [{ id: 'a' }], error: null });
    from.mockReturnValue(q);
    const result = await listRecords({ farmId: 'farm-1', kind: 'purchase' });
    expect(result.data).toEqual([{ id: 'a' }]);
    expect(callArgs(q, 'eq')).toEqual(['farm_id', 'farm-1']);
    expect(q.calls.filter((c) => c[0] === 'eq').map((c) => c[1])).toEqual(['farm_id', 'kind']);
    expect(callArgs(q, 'in')).toEqual(['status', ['draft', 'needs_info', 'pending_review', 'approved', 'rejected']]);
    expect(callArgs(q, 'order')[0]).toBe('record_date');
    expect(callArgs(q, 'limit')[0]).toBeGreaterThan(0);
  });

  it('can list specific statuses (the review queue)', async () => {
    const q = chain({ data: [], error: null });
    from.mockReturnValue(q);
    await listRecords({ farmId: 'farm-1', statuses: ['pending_review', 'needs_info'] });
    expect(callArgs(q, 'in')).toEqual(['status', ['pending_review', 'needs_info']]);
  });

  it('runs a saved view by applying its parsed filter and scoping to the farm', async () => {
    const q = chain({ data: [{ id: 'v' }], error: null });
    from.mockReturnValue(q);
    const view = { id: 'sv1', filter: { kinds: ['harvest'], status: ['approved'], season: 'current', where: [] } };
    const result = await listSavedViewRecords(view, { farm: FARM, today: '2026-10-12' });
    expect(result.data).toEqual([{ id: 'v' }]);
    expect(callArgs(q, 'eq')).toEqual(['farm_id', 'farm-1']);
    expect(callNames(q)).toEqual(expect.arrayContaining(['in', 'gte', 'lt']));
  });

  it('refuses to run a saved view whose stored filter is malformed', async () => {
    const result = await listSavedViewRecords({ id: 'sv1', filter: { sql: 'drop table records' } }, { farm: FARM, today: '2026-10-12' });
    expect(result.error.code).toBe('invalid');
    expect(from).not.toHaveBeenCalled();
  });

  it('counts records waiting for review without fetching them', async () => {
    const q = chain({ count: 7, error: null });
    from.mockReturnValue(q);
    expect(await countNeedsReview('farm-1')).toEqual({ data: 7, error: null });
    expect(callArgs(q, 'select')).toEqual(['id', { count: 'exact', head: true }]);
    expect(callArgs(q, 'eq')).toEqual(['farm_id', 'farm-1']);
  });

  it('lists revisions for a record oldest first, or recent changes for the farm', async () => {
    const q = chain({ data: [], error: null });
    from.mockReturnValue(q);
    await listRevisions({ farmId: 'farm-1', recordId: 'r1' });
    expect(from).toHaveBeenCalledWith('record_revisions');
    expect(q.calls.filter((c) => c[0] === 'eq').map((c) => c.slice(1))).toEqual([['farm_id', 'farm-1'], ['record_id', 'r1']]);
    expect(callArgs(q, 'order')).toEqual(['version', { ascending: true }]);

    const q2 = chain({ data: [], error: null });
    from.mockReturnValue(q2);
    await listRevisions({ farmId: 'farm-1' });
    expect(callArgs(q2, 'order')).toEqual(['changed_at', { ascending: false }]);
  });
});

describe('saved views', () => {
  it('lists a farm’s views in order and silently drops ones whose filter does not parse', async () => {
    from.mockReturnValue(chain({ data: [
      { id: '1', name: 'Good', filter: { kinds: ['harvest'] }, position: 1 },
      { id: '2', name: 'Bad', filter: { evil: true }, position: 2 },
    ], error: null }));
    const { data } = await listSavedViews('farm-1');
    expect(data.map((v) => v.id)).toEqual(['1']);
    expect(data[0].filter).toEqual({ kinds: ['harvest'], status: ['approved'], season: 'all', where: [] });
  });

  it('validates a view before saving it and never sends identity columns', async () => {
    const q = chain({ data: { id: 'n' }, error: null });
    from.mockReturnValue(q);
    await createSavedView({ farmId: 'farm-1', name: ' Kelp ', filter: { kinds: ['purchase'] }, slug: 'hack', is_default: true });
    const [row] = callArgs(q, 'insert');
    expect(row).toMatchObject({ farm_id: 'farm-1', name: 'Kelp' });
    expect(row).not.toHaveProperty('slug');
    expect(row).not.toHaveProperty('is_default');

    expect((await createSavedView({ farmId: 'farm-1', name: 'x', filter: { sql: 1 } })).error.code).toBe('invalid');
    expect((await createSavedView({ farmId: 'farm-1', name: '  ', filter: {} })).error.code).toBe('invalid');
  });

  it('updates and deletes by id', async () => {
    const q = chain({ data: { id: 'n' }, error: null });
    from.mockReturnValue(q);
    await updateSavedView('n', { name: 'New', pinned: false });
    expect(callArgs(q, 'update')[0]).toEqual({ name: 'New', pinned: false });

    const q2 = chain({ error: null });
    from.mockReturnValue(q2);
    expect((await deleteSavedView('n')).error).toBeNull();
    expect(callArgs(q2, 'eq')).toEqual(['id', 'n']);
  });
});

describe('getMyRole', () => {
  it('reads the caller’s role in the farm', async () => {
    const q = chain({ data: { role: 'manager' }, error: null });
    from.mockReturnValue(q);
    expect(await getMyRole('farm-1', 'user-1')).toBe('manager');
    expect(from).toHaveBeenCalledWith('farm_members');
  });

  it('returns null when there is no membership or on error', async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    expect(await getMyRole('farm-1', 'user-1')).toBeNull();
    from.mockReturnValue(chain({ data: null, error: { message: 'x' } }));
    expect(await getMyRole('farm-1', 'user-1')).toBeNull();
    expect(await getMyRole(null, 'user-1')).toBeNull();
  });
});
