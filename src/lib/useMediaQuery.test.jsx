// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useMediaQuery, { PHONE_QUERY } from './useMediaQuery.js';

/** A matchMedia stand-in whose answer the test can change. */
function fakeMatchMedia(initial) {
  let matches = initial;
  const listeners = new Set();
  const media = vi.fn((query) => ({
    media: query,
    get matches() { return matches; },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  }));
  return {
    media,
    listeners,
    set(next) {
      matches = next;
      listeners.forEach((listener) => listener({ matches }));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useMediaQuery', () => {
  it('says whether the query matches now', () => {
    const fake = fakeMatchMedia(true);
    vi.stubGlobal('matchMedia', fake.media);
    const { result } = renderHook(() => useMediaQuery(PHONE_QUERY));
    expect(result.current).toBe(true);
    expect(fake.media).toHaveBeenCalledWith(PHONE_QUERY);
  });

  it('follows the screen when it changes, for example when a phone is turned', () => {
    const fake = fakeMatchMedia(false);
    vi.stubGlobal('matchMedia', fake.media);
    const { result } = renderHook(() => useMediaQuery(PHONE_QUERY));
    expect(result.current).toBe(false);
    act(() => fake.set(true));
    expect(result.current).toBe(true);
  });

  it('stops listening when it is no longer used', () => {
    const fake = fakeMatchMedia(false);
    vi.stubGlobal('matchMedia', fake.media);
    const { unmount } = renderHook(() => useMediaQuery(PHONE_QUERY));
    expect(fake.listeners.size).toBe(1);
    unmount();
    expect(fake.listeners.size).toBe(0);
  });

  it('answers false where the browser cannot tell (no matchMedia)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery(PHONE_QUERY));
    expect(result.current).toBe(false);
  });

  it('describes a phone as a screen narrower than a small tablet', () => {
    expect(PHONE_QUERY).toBe('(max-width: 767px)');
  });
});
