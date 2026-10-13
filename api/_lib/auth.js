import { createClient } from '@supabase/supabase-js';

/**
 * Build a function that verifies a Supabase access token (JWT) server-side.
 *
 * - Resolves to `{ id, email }` for a valid token.
 * - Resolves to `null` when the token is invalid or expired (a 4xx from Supabase Auth, except 408/429).
 * - Throws when verification cannot be performed (not configured, Supabase down),
 *   so the caller can fail closed instead of letting the request through.
 *
 * The anon key is public by design, so falling back to the VITE_ names is safe here.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ createClientImpl?: typeof createClient }} [deps]
 * @returns {(token: string) => Promise<{ id: string, email: string | undefined } | null>}
 */
export function createSupabaseTokenVerifier(env = process.env, { createClientImpl = createClient } = {}) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return async () => {
      throw new Error('Supabase auth is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY.');
    };
  }

  const client = createClientImpl(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return async function verifyToken(token) {
    const { data, error } = await client.auth.getUser(token);

    if (error) {
      const status = Number(error.status);
      // 408/429 mean Supabase is throttling or timing out, not that the token is bad:
      // surface them as an outage (503) instead of telling users to sign in again.
      const isTokenProblem = status >= 400 && status < 500 && status !== 408 && status !== 429;
      if (isTokenProblem) return null;
      throw error;
    }

    return data?.user ? { id: data.user.id, email: data.user.email } : null;
  };
}
