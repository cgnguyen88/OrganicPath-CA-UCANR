// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, waitFor, act, cleanup } from '@testing-library/react';

vi.mock('../../lib/fields.js', () => ({ listFields: vi.fn() }));
const { listFields } = await import('../../lib/fields.js');
const { useLoadFarmFields, useFarmFields, FarmFieldsContext } = await import('./farmFields.js');
const { default: FarmFieldsProvider } = await import('./FarmFieldsProvider.jsx');

const ok = (fields) => ({ data: fields, error: null });
const B2 = { id: 'f-b2', name: 'B2', is_active: true };
const NORTH = { id: 'f-n', name: 'North 40', is_active: true };
const run = (farmId) => renderHook((id) => useLoadFarmFields(id), { initialProps: farmId });

beforeEach(() => {
  listFields.mockReset();
  listFields.mockResolvedValue(ok([B2]));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(cleanup);

describe('useLoadFarmFields', () => {
  it('starts loading, then has the farm’s fields', async () => {
    const { result } = run('farm-1');
    expect(result.current).toMatchObject({ status: 'loading', fields: [] });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.fields).toEqual([B2]);
    expect(listFields).toHaveBeenCalledWith('farm-1');
  });

  it('says so, with no fields, when they could not be read', async () => {
    listFields.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    const { result } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.fields).toEqual([]);
  });

  it('says why when the fields could not be read, so a screen can explain it', async () => {
    listFields.mockResolvedValue({ data: null, error: { code: 'not_set_up' } });
    const { result } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorCode).toBe('not_set_up');
    listFields.mockResolvedValue(ok([B2]));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.errorCode).toBeNull();
  });

  it('says so, rather than waiting for ever, when reading throws', async () => {
    listFields.mockRejectedValue(new Error('network down'));
    const { result } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(console.error).toHaveBeenCalled();
  });

  it('has nothing to read, and does not ask, when there is no farm yet', async () => {
    const { result } = run(undefined);
    expect(result.current).toMatchObject({ status: 'ready', fields: [] });
    expect(listFields).not.toHaveBeenCalled();
  });

  it('does not read again when it is re-rendered for the same farm', async () => {
    const { result, rerender } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender('farm-1');
    rerender('farm-1');
    expect(listFields).toHaveBeenCalledTimes(1);
  });

  it('shows loading, with none of the old farm’s fields, as soon as the farm changes', async () => {
    const { result, rerender } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listFields.mockResolvedValue(ok([NORTH]));
    rerender('farm-2');
    expect(result.current).toMatchObject({ status: 'loading', fields: [] });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.fields).toEqual([NORTH]);
  });

  it('ignores an answer that arrives late for a farm it is no longer asking about', async () => {
    let answerFirst;
    listFields.mockReturnValueOnce(new Promise((resolve) => { answerFirst = resolve; }));
    listFields.mockResolvedValueOnce(ok([NORTH]));
    const { result, rerender } = run('farm-1');
    rerender('farm-2');
    await waitFor(() => expect(result.current.fields).toEqual([NORTH]));
    await act(async () => { answerFirst(ok([B2])); });
    expect(result.current.fields).toEqual([NORTH]);
  });

  it('reads again on reload, and keeps showing the fields while it does', async () => {
    const { result } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let answer;
    listFields.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    act(() => result.current.reload());
    expect(result.current.status).toBe('ready');
    expect(result.current.fields).toEqual([B2]);
    await act(async () => { answer(ok([B2, NORTH])); });
    expect(result.current.fields).toEqual([B2, NORTH]);
    expect(listFields).toHaveBeenCalledTimes(2);
  });

  it('keeps the fields it had, and says so, when a reload fails', async () => {
    const { result } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listFields.mockResolvedValueOnce({ data: null, error: { code: 'unknown' } });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.fields).toEqual([B2]);
  });

  it('does not carry a failed farm’s old fields over to another farm', async () => {
    const { result, rerender } = run('farm-1');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    listFields.mockResolvedValue({ data: null, error: { code: 'unknown' } });
    rerender('farm-2');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.fields).toEqual([]);
  });
});

describe('useFarmFields', () => {
  const Show = () => {
    const { status, fields } = useFarmFields();
    return <p>{`${status}:${fields.map((f) => f.name).join(',')}`}</p>;
  };

  it('is an empty, ready list outside a provider, so a form works without one', () => {
    render(<Show />);
    expect(screen.getByText('ready:')).toBeTruthy();
  });

  it('gives what the provider loaded', async () => {
    render(<FarmFieldsProvider farmId="farm-1"><Show /></FarmFieldsProvider>);
    expect(screen.getByText('loading:')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('ready:B2')).toBeTruthy());
  });

  it('gives whatever value a context provider sets', () => {
    render(<FarmFieldsContext.Provider value={{ status: 'ready', fields: [NORTH], reload: () => {} }}><Show /></FarmFieldsContext.Provider>);
    expect(screen.getByText('ready:North 40')).toBeTruthy();
  });
});
