// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { default: useFarmMaterials, materialsSince } = await import('./useFarmMaterials.js');

let n = 0;
const rec = (kind, record_date, payload) => ({ id: `r${++n}`, kind, status: 'approved', record_date, payload, created_at: '2026-01-01T00:00:00Z' });
const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });

beforeEach(() => {
  listRecordsForReport.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('materialsSince', () => {
  it('is a year before today', () => {
    expect(materialsSince('2026-10-14')).toBe('2025-10-14');
    expect(materialsSince('2028-02-29')).toBe('2027-02-28');
  });
});

describe('useFarmMaterials', () => {
  it('reads the dated records from a year back, and the Input List (which has no dates) in full', async () => {
    listRecordsForReport.mockResolvedValue(ok([]));
    renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalledTimes(2));
    const calls = listRecordsForReport.mock.calls.map(([args]) => args);
    expect(calls).toContainEqual({ farmId: 'farm-1', kinds: ['purchase', 'amendment', 'activity'], from: '2025-10-14', includeUnapproved: false });
    expect(calls).toContainEqual({ farmId: 'farm-1', kinds: ['input'], from: undefined, includeUnapproved: false });
  });

  it('puts the records of both reads together into one list of materials', async () => {
    listRecordsForReport.mockImplementation(async ({ kinds }) =>
      kinds.includes('input')
        ? ok([rec('input', null, { product: 'Kelp', omri_listing_number: 'OMRI-1' })])
        : ok([rec('purchase', '2026-03-01', { supplier: 'Sea Co', product: 'Kelp', omri_status: 'listed' }), rec('activity', '2026-05-01', { activity_type: 'spray', field: 'B2', product: 'Neem oil' })]));
    const { result } = renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.materials.map((m) => m.name)).toEqual(['Kelp', 'Neem oil']);
    expect(result.current.materials[0]).toMatchObject({ onInputList: true, omriListingNumber: 'OMRI-1', suppliers: ['Sea Co'] });
    expect(result.current.records).toHaveLength(3);
  });

  it('is still loading until both reads are done', async () => {
    let finishInputs;
    listRecordsForReport.mockImplementation(({ kinds }) => (kinds.includes('input') ? new Promise((resolve) => { finishInputs = resolve; }) : Promise.resolve(ok([]))));
    const { result } = renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalledTimes(2));
    expect(result.current.status).toBe('loading');
    finishInputs(ok([]));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('says so if either read fails', async () => {
    listRecordsForReport.mockImplementation(async ({ kinds }) => (kinds.includes('input') ? { data: null, error: { code: 'unknown' } } : ok([])));
    const { result } = renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.materials).toEqual([]);
  });

  it('says so if the list of either was cut short', async () => {
    listRecordsForReport.mockImplementation(async ({ kinds }) => ok([], kinds.includes('input')));
    const { result } = renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.truncated).toBe(true);
  });

  it('says so if the list of dated records was cut short', async () => {
    listRecordsForReport.mockImplementation(async ({ kinds }) => ok([], !kinds.includes('input')));
    const { result } = renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.truncated).toBe(true);
  });

  it('is not cut short when neither read was', async () => {
    listRecordsForReport.mockResolvedValue(ok([]));
    const { result } = renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.truncated).toBe(false);
  });

  it('has no materials, and asks for nothing, when there is no farm yet', async () => {
    const { result } = renderHook(() => useFarmMaterials(undefined, '2025-10-14'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.materials).toEqual([]);
    expect(listRecordsForReport).not.toHaveBeenCalled();
  });

  it('can read everything again', async () => {
    listRecordsForReport.mockResolvedValue(ok([]));
    const { result } = renderHook(() => useFarmMaterials('farm-1', '2025-10-14'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    result.current.reload();
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalledTimes(4));
  });
});
