import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSession = vi.fn();
vi.mock('./supabase.js', () => ({ supabase: { auth: { getSession: (...args) => getSession(...args) } } }));

const { authedFetch } = await import('./apiClient.js');

describe('authedFetch', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

  beforeEach(() => {
    getSession.mockReset();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('adds the Supabase access token as a Bearer header', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
    await authedFetch('/api/claude', { method: 'POST', body: '{}' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/claude');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-123');
  });

  it('keeps the caller headers (Content-Type) and does not mutate the caller init', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
    const init = { headers: { 'Content-Type': 'application/json' } };
    await authedFetch('/api/claude', init);

    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Content-Type')).toBe('application/json');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('refuses to call the API (and never calls fetch) when signed out, with a typed error callers can recognise', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(authedFetch('/api/claude')).rejects.toMatchObject({ code: 'not_signed_in', message: expect.stringMatching(/sign/i) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets a caller-supplied Authorization header NOT override the session token', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'real' } } });
    await authedFetch('/api/claude', { headers: { Authorization: 'Bearer spoofed' } });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer real');
  });
});
