import { describe, it, expect, vi } from 'vitest';
import { createSupabaseTokenVerifier } from './auth.js';

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };

function verifierWith(getUser) {
  const createClientImpl = vi.fn(() => ({ auth: { getUser } }));
  return { verify: createSupabaseTokenVerifier(env, { createClientImpl }), createClientImpl };
}

describe('createSupabaseTokenVerifier', () => {
  it('returns the user for a valid token', async () => {
    const { verify } = verifierWith(async () => ({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null }));
    await expect(verify('tok')).resolves.toEqual({ id: 'u1', email: 'a@b.c' });
  });

  it('passes the token to Supabase and disables session persistence', async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null }));
    const { verify, createClientImpl } = verifierWith(getUser);
    await verify('tok');
    expect(getUser).toHaveBeenCalledWith('tok');
    expect(createClientImpl.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });

  it.each([400, 401, 403, 404])('returns null for a %i from Supabase Auth (bad or expired token)', async (status) => {
    const { verify } = verifierWith(async () => ({ data: { user: null }, error: { status, message: 'bad jwt' } }));
    await expect(verify('tok')).resolves.toBeNull();
  });

  it.each([0, 408, 429, 500, 503])('throws for a %i (cannot verify, so the caller must fail closed)', async (status) => {
    const { verify } = verifierWith(async () => ({ data: { user: null }, error: { status, message: 'down' } }));
    await expect(verify('tok')).rejects.toBeDefined();
  });

  it('returns null when Supabase reports no user and no error', async () => {
    const { verify } = verifierWith(async () => ({ data: { user: null }, error: null }));
    await expect(verify('tok')).resolves.toBeNull();
  });

  it('accepts the public VITE_ names for URL and anon key', async () => {
    const createClientImpl = vi.fn(() => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) } }));
    const verify = createSupabaseTokenVerifier({ VITE_SUPABASE_URL: 'https://y', VITE_SUPABASE_ANON_KEY: 'k' }, { createClientImpl });
    await expect(verify('t')).resolves.toMatchObject({ id: 'u' });
    expect(createClientImpl.mock.calls[0][0]).toBe('https://y');
  });

  it('fails closed (throws on use) when Supabase is not configured', async () => {
    const verify = createSupabaseTokenVerifier({});
    await expect(verify('tok')).rejects.toThrow(/not configured/i);
  });
});
