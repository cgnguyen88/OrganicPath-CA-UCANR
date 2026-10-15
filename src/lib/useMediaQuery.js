import { useCallback, useSyncExternalStore } from 'react';

/** Screens narrower than a small tablet get the phone layout (top bar, slide-out menu, stacked columns). */
export const PHONE_QUERY = '(max-width: 767px)';

const listFor = (query) => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(query) : null);

/**
 * Whether a CSS media query matches, kept up to date as the window changes (a phone turned sideways,
 * a window resized). False where the browser cannot tell.
 *
 * @param {string} query
 * @returns {boolean}
 */
export default function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    const list = listFor(query);
    if (!list) return () => {};
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  const read = () => listFor(query)?.matches ?? false;
  return useSyncExternalStore(subscribe, read, () => false);
}
