// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../../lib/records.js', () => ({ getMyRole: vi.fn(), listSavedViews: vi.fn(), countNeedsReview: vi.fn() }));
const records = await import('../../lib/records.js');
const { default: useRecordsMeta } = await import('./useRecordsMeta.js');

const FARM = { id: 'farm-1' };

beforeEach(() => {
  Object.values(records).forEach((fn) => fn.mockReset());
  records.getMyRole.mockResolvedValue('manager');
  records.listSavedViews.mockResolvedValue({ data: [{ id: 'v1', name: 'A', pinned: true, position: 1, filter: {} }], error: null });
  records.countNeedsReview.mockResolvedValue({ data: 4, error: null });
});

describe('useRecordsMeta', () => {
  it('does nothing until there is a farm and a user', () => {
    const { result } = renderHook(() => useRecordsMeta({ farm: null, userId: 'u1' }));
    expect(result.current).toMatchObject({ role: null, savedViews: [], needsReviewCount: 0 });
    expect(records.getMyRole).not.toHaveBeenCalled();
  });

  it('loads the role, the saved views and the review count', async () => {
    const { result } = renderHook(() => useRecordsMeta({ farm: FARM, userId: 'u1' }));
    await waitFor(() => expect(result.current.role).toBe('manager'));
    expect(result.current.savedViews).toHaveLength(1);
    expect(result.current.needsReviewCount).toBe(4);
    expect(records.getMyRole).toHaveBeenCalledWith('farm-1', 'u1');
  });

  it('refreshes the count and views on demand', async () => {
    const { result } = renderHook(() => useRecordsMeta({ farm: FARM, userId: 'u1' }));
    await waitFor(() => expect(result.current.needsReviewCount).toBe(4));
    records.countNeedsReview.mockResolvedValue({ data: 1, error: null });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.needsReviewCount).toBe(1);
  });

  it('keeps sensible defaults when loading fails', async () => {
    records.getMyRole.mockResolvedValue(null);
    records.listSavedViews.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    records.countNeedsReview.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    const { result } = renderHook(() => useRecordsMeta({ farm: FARM, userId: 'u1' }));
    await waitFor(() => expect(records.countNeedsReview).toHaveBeenCalled());
    expect(result.current).toMatchObject({ role: null, savedViews: [], needsReviewCount: 0 });
  });

  it('forgets everything when the farm goes away (sign-out)', async () => {
    const { result, rerender } = renderHook(({ farm }) => useRecordsMeta({ farm, userId: 'u1' }), { initialProps: { farm: FARM } });
    await waitFor(() => expect(result.current.role).toBe('manager'));
    rerender({ farm: null });
    await waitFor(() => expect(result.current).toMatchObject({ role: null, savedViews: [], needsReviewCount: 0 }));
  });

  it('reports when the first load has finished (so screens can tell "still loading" from "does not exist")', async () => {
    const { result } = renderHook(() => useRecordsMeta({ farm: FARM, userId: 'u1' }));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    const none = renderHook(() => useRecordsMeta({ farm: null, userId: 'u1' }));
    expect(none.result.current.ready).toBe(false);
  });

  it('drops a refresh that finishes after the farm changed, instead of mixing farm A data into farm B', async () => {
    let finishRefresh;
    const { result, rerender } = renderHook(({ farm }) => useRecordsMeta({ farm, userId: 'u1' }), { initialProps: { farm: FARM } });
    await waitFor(() => expect(result.current.ready).toBe(true));

    records.listSavedViews.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = () => resolve({ data: [{ id: 'A-view', name: 'A', pinned: true, position: 1, filter: {} }], error: null }); }));
    records.countNeedsReview.mockResolvedValueOnce({ data: 99, error: null });
    let pending;
    act(() => { pending = result.current.refresh(); });

    records.listSavedViews.mockResolvedValue({ data: [{ id: 'B-view', name: 'B', pinned: true, position: 1, filter: {} }], error: null });
    records.countNeedsReview.mockResolvedValue({ data: 2, error: null });
    rerender({ farm: { id: 'farm-B' } });
    await waitFor(() => expect(result.current.savedViews[0]?.id).toBe('B-view'));

    await act(async () => { finishRefresh(); await pending; });
    expect(result.current.savedViews.map((v) => v.id)).toEqual(['B-view']);
    expect(result.current.needsReviewCount).toBe(2);
  });
});
