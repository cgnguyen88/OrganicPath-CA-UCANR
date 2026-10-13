import { supabase } from './supabase.js';

/**
 * fetch() for our own authenticated API routes. Attaches the signed-in user's
 * Supabase access token; the server verifies it before doing any work.
 *
 * @param {string} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 * @throws {Error} with `code: 'not_signed_in'` when nobody is signed in (no request is sent).
 */
export async function authedFetch(input, init = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw Object.assign(new Error('Please sign in to use this feature.'), { code: 'not_signed_in' });
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}
