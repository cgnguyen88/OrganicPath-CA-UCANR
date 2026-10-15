// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../utils/markdown/clipboard.js', () => ({ copyAiText: vi.fn() }));
vi.mock('../utils/markdown/aiDocument.js', () => ({ downloadAiDocx: vi.fn() }));
const { copyAiText } = await import('../utils/markdown/clipboard.js');
const { downloadAiDocx } = await import('../utils/markdown/aiDocument.js');
const { default: useAiOutputActions } = await import('./useAiOutputActions.js');

beforeEach(() => {
  vi.useFakeTimers();
  copyAiText.mockReset().mockResolvedValue(true);
  downloadAiDocx.mockReset().mockResolvedValue();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const setup = (markdown = '## Plan') => renderHook(({ text }) => useAiOutputActions(text, () => ({ title: 'Plan', markdown: text })), { initialProps: { text: markdown } });

describe('useAiOutputActions: copy', () => {
  it('copies the text and says so for two seconds', async () => {
    const { result } = setup('## Plan\n\n- a');
    expect(result.current.copied).toBe(false);
    await act(async () => { await result.current.copy(); });
    expect(copyAiText).toHaveBeenCalledWith('## Plan\n\n- a');
    expect(result.current.copied).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.copied).toBe(false);
  });

  it('says it failed when the copy did not work, instead of saying nothing', async () => {
    copyAiText.mockResolvedValue(false);
    const { result } = setup();
    await act(async () => { await result.current.copy(); });
    expect(result.current.copied).toBe(false);
    expect(result.current.copyFailed).toBe(true);
  });

  it('forgets a failure once a copy works', async () => {
    copyAiText.mockResolvedValueOnce(false);
    const { result } = setup();
    await act(async () => { await result.current.copy(); });
    await act(async () => { await result.current.copy(); });
    expect(result.current.copyFailed).toBe(false);
    expect(result.current.copied).toBe(true);
  });

  it('does not touch state after the screen is gone', async () => {
    let finish;
    copyAiText.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, unmount } = setup();
    let pending;
    act(() => { pending = result.current.copy(); });
    unmount();
    await act(async () => { finish(true); await pending; });
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});

describe('useAiOutputActions: download', () => {
  it('downloads the document it is asked to make', async () => {
    const { result } = setup('x');
    await act(async () => { await result.current.download(); });
    expect(downloadAiDocx).toHaveBeenCalledWith({ title: 'Plan', markdown: 'x' });
    expect(result.current.downloadFailed).toBe(false);
    expect(result.current.downloading).toBe(false);
  });

  it('reports a download that fails, and clears the report on the next try', async () => {
    downloadAiDocx.mockRejectedValueOnce(new Error('zip failed'));
    const { result } = setup();
    await act(async () => { await result.current.download(); });
    expect(result.current.downloadFailed).toBe(true);
    expect(console.error).toHaveBeenCalled();
    await act(async () => { await result.current.download(); });
    expect(result.current.downloadFailed).toBe(false);
  });

  it('saves one file for a double click', async () => {
    let finish;
    downloadAiDocx.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = setup();
    let first;
    act(() => { first = result.current.download(); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.downloading).toBe(true);
    await act(async () => { await result.current.download(); });
    expect(downloadAiDocx).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await first; });
    expect(result.current.downloading).toBe(false);
  });
});

describe('useAiOutputActions: what the buttons report belongs to the text', () => {
  it('forgets a failed download and a copy message when the text changes', async () => {
    downloadAiDocx.mockRejectedValueOnce(new Error('zip failed'));
    const { result, rerender } = setup('first draft');
    await act(async () => { await result.current.download(); });
    await act(async () => { await result.current.copy(); });
    expect(result.current.downloadFailed).toBe(false);
    expect(result.current.copied).toBe(true);
    rerender({ text: 'second draft' });
    expect(result.current.copied).toBe(false);
    expect(result.current.copyFailed).toBe(false);
    expect(result.current.downloadFailed).toBe(false);
  });

  it('forgets a failed download when the text changes', async () => {
    downloadAiDocx.mockRejectedValueOnce(new Error('zip failed'));
    const { result, rerender } = setup('first draft');
    await act(async () => { await result.current.download(); });
    expect(result.current.downloadFailed).toBe(true);
    rerender({ text: 'second draft' });
    expect(result.current.downloadFailed).toBe(false);
  });

  it('does not show a result for old text if the text changed while it was working', async () => {
    let finish;
    copyAiText.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, rerender } = setup('first draft');
    let pending;
    act(() => { pending = result.current.copy(); });
    rerender({ text: 'second draft' });
    await act(async () => { finish(true); await pending; });
    expect(result.current.copied).toBe(false);
  });
});
