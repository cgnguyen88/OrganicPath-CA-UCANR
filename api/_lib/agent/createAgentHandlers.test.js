import { describe, it, expect, vi } from 'vitest';
import { createAgentHandlers } from './createAgentHandlers.js';

const logger = () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() });
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k' };

describe('createAgentHandlers', () => {
  it('returns the capture, reply and material-check handlers', () => {
    const { capture, reply, material, telegram } = createAgentHandlers(ENV, logger());
    expect(typeof capture).toBe('function');
    expect(typeof reply).toBe('function');
    expect(typeof material).toBe('function');
    expect(typeof telegram).toBe('function');
  });

  it('warns when the service-role key is missing, because captured records cannot be saved without it', () => {
    const log = logger();
    const { SUPABASE_SERVICE_ROLE_KEY: _drop, ...env } = ENV;
    createAgentHandlers(env, log);
    expect(log.warn.mock.calls.flat().join(' ')).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('warns loudly when the service-role key is stored under a VITE_ name (it would ship to browsers)', () => {
    const log = logger();
    createAgentHandlers({ ...ENV, VITE_SUPABASE_SERVICE_ROLE_KEY: 'oops' }, log);
    const text = log.warn.mock.calls.flat().join(' ');
    expect(text).toMatch(/VITE_SUPABASE_SERVICE_ROLE_KEY/);
    expect(text).toMatch(/rotate/i);
    expect(text).not.toContain('oops');
  });

  it('stays quiet when configured correctly', () => {
    const log = logger();
    createAgentHandlers(ENV, log);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
