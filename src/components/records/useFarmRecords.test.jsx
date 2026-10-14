// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

vi.mock('../../lib/reportData.js', () => ({ listRecordsForReport: vi.fn() }));
const { listRecordsForReport } = await import('../../lib/reportData.js');
const { default: useFarmRecords } = await import('./useFarmRecords.js');

const ok = (records, truncated = false) => ({ data: { records, truncated }, error: null });
const run = (props) => renderHook((p) => useFarmRecords(p), { initialProps: props });

beforeEach(() => {
  listRecordsForReport.mockReset();
  listRecordsForReport.mockResolvedValue(ok([{ id: 'a' }]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('useFarmRecords', () => {
  it('starts loading, then has the records', async () => {
    const { result } = run({ farmId: 'farm-1', kinds: ['purchase'], from: '2026-01-01' });
    expect(result.current).toMatchObject({ status: 'loading', records: [], truncated: false });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.records).toEqual([{ id: 'a' }]);
  });

  it('asks for this farm’s approved records of the chosen kinds from the chosen date', async () => {
    run({ farmId: 'farm-1', kinds: ['purchase', 'input'], from: '2026-01-01' });
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalledTimes(1));
    expect(listRecordsForReport).toHaveBeenCalledWith({ farmId: 'farm-1', kinds: ['purchase', 'input'], from: '2026-01-01', includeUnapproved: false });
  });

  it('passes on that the list was cut short', async () => {
    listRecordsForReport.mockResolvedValue(ok([{ id: 'a' }], true));
    const { result } = run({ farmId: 'farm-1' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.truncated).toBe(true);
  });

  it('says so when the records could not be read, with no records', async () => {
    listRecordsForReport.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    const { result } = run({ farmId: 'farm-1' });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.records).toEqual([]);
  });

  it('says so, rather than waiting for ever, when reading throws', async () => {
    listRecordsForReport.mockRejectedValue(new Error('network down'));
    const { result } = run({ farmId: 'farm-1' });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('has nothing to read, and does not ask, when there is no farm yet', async () => {
    const { result } = run({ farmId: undefined });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.records).toEqual([]);
    expect(listRecordsForReport).not.toHaveBeenCalled();
  });

  it('does not read again when it is re-rendered with the same things to ask for', async () => {
    const { result, rerender } = run({ farmId: 'farm-1', kinds: ['purchase'], from: '2026-01-01' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ farmId: 'farm-1', kinds: ['purchase'], from: '2026-01-01' });
    rerender({ farmId: 'farm-1', kinds: ['purchase'], from: '2026-01-01' });
    expect(listRecordsForReport).toHaveBeenCalledTimes(1);
  });

  it('reads again, and shows loading, when what to ask for changes', async () => {
    const { result, rerender } = run({ farmId: 'farm-1', kinds: ['purchase'], from: '2026-01-01' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listRecordsForReport.mockReturnValueOnce(new Promise(() => {}));
    rerender({ farmId: 'farm-1', kinds: ['purchase'], from: '2025-01-01' });
    expect(result.current.status).toBe('loading');
    expect(result.current.records).toEqual([]);
    expect(listRecordsForReport).toHaveBeenCalledTimes(2);
  });

  it('reads again when the kinds change, and when the farm changes', async () => {
    const { result, rerender } = run({ farmId: 'farm-1', kinds: ['purchase'] });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ farmId: 'farm-1', kinds: ['purchase', 'input'] });
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalledTimes(2));
    expect(listRecordsForReport).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['purchase', 'input'] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listRecordsForReport.mockReturnValueOnce(new Promise(() => {}));
    rerender({ farmId: 'farm-2', kinds: ['purchase', 'input'] });
    expect(result.current).toMatchObject({ status: 'loading', records: [] }); // never one farm's records under another's name
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalledTimes(3));
    expect(listRecordsForReport).toHaveBeenLastCalledWith(expect.objectContaining({ farmId: 'farm-2' }));
  });

  it('ignores an answer that arrives late for something it is no longer asking for', async () => {
    const pending = [];
    listRecordsForReport.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { result, rerender } = run({ farmId: 'farm-1', from: '2025-01-01' });
    rerender({ farmId: 'farm-1', from: '2024-01-01' });
    await act(async () => { pending[1](ok([{ id: 'new' }])); });
    await waitFor(() => expect(result.current.records).toEqual([{ id: 'new' }]));
    await act(async () => { pending[0](ok([{ id: 'old' }])); });
    expect(result.current.records).toEqual([{ id: 'new' }]);
  });

  it('reads again when asked to', async () => {
    const { result } = run({ farmId: 'farm-1' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listRecordsForReport.mockResolvedValue(ok([{ id: 'b' }]));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.records).toEqual([{ id: 'b' }]));
    expect(listRecordsForReport).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the records it has, as ready, while it reads again after a successful read', async () => {
    const { result } = run({ farmId: 'farm-1' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let answer;
    listRecordsForReport.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'ready', records: [{ id: 'a' }] });
    await act(async () => { answer(ok([{ id: 'b' }])); });
    expect(result.current.records).toEqual([{ id: 'b' }]);
  });

  it('shows loading again, with no records, when it is asked to read again after a failure', async () => {
    listRecordsForReport.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    const { result } = run({ farmId: 'farm-1' });
    await waitFor(() => expect(result.current.status).toBe('error'));
    let answer;
    listRecordsForReport.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'loading', records: [] });
    await act(async () => { answer(ok([{ id: 'b' }])); });
    expect(result.current).toMatchObject({ status: 'ready', records: [{ id: 'b' }] });
  });

  it('says so, with no records, when a read after a successful one fails', async () => {
    const { result } = run({ farmId: 'farm-1' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listRecordsForReport.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.records).toEqual([]);
  });

  it('can be told to leave out records of a kind it was not asked about', async () => {
    run({ farmId: 'farm-1' });
    await waitFor(() => expect(listRecordsForReport).toHaveBeenCalled());
    expect(listRecordsForReport.mock.calls[0][0].kinds).toBeUndefined();
  });
});
