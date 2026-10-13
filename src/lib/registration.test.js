import { describe, it, expect } from 'vitest';
import { buildSignUpPayload, interpretSignUp, FARM_NAME_MAX } from './registration.js';

const valid = { name: ' Ana Lopez ', email: ' ana@example.com ', password: 'secret1', farmName: '  Sunny Acres  ' };

describe('buildSignUpPayload', () => {
  it('trims fields and puts name and farm_name in the auth metadata the DB trigger reads', () => {
    expect(buildSignUpPayload(valid)).toEqual({
      ok: true,
      payload: {
        email: 'ana@example.com',
        password: 'secret1',
        options: { data: { name: 'Ana Lopez', farm_name: 'Sunny Acres' } },
      },
    });
  });

  it('never trims or alters the password', () => {
    const result = buildSignUpPayload({ ...valid, password: '  spaced pass  ' });
    expect(result.payload.password).toBe('  spaced pass  ');
  });

  it.each([
    ['name', { name: '   ' }],
    ['email', { email: '' }],
    ['password', { password: '' }],
    ['farmName', { farmName: '  ' }],
  ])('requires %s', (field, override) => {
    expect(buildSignUpPayload({ ...valid, ...override })).toEqual({ ok: false, field, code: 'required' });
  });

  it('rejects a farm name over the database limit instead of letting the DB silently cut it', () => {
    const result = buildSignUpPayload({ ...valid, farmName: 'x'.repeat(FARM_NAME_MAX + 1) });
    expect(result).toEqual({ ok: false, field: 'farmName', code: 'too_long' });
    expect(FARM_NAME_MAX).toBe(120);
  });

  it('accepts a farm name of exactly the limit', () => {
    expect(buildSignUpPayload({ ...valid, farmName: 'x'.repeat(FARM_NAME_MAX) }).ok).toBe(true);
  });

  it('reports the first problem in form order (name, email, password, farm name)', () => {
    expect(buildSignUpPayload({ name: '', email: '', password: '', farmName: '' }).field).toBe('name');
  });
});

describe('interpretSignUp', () => {
  const user = { id: 'u1', email: 'ana@example.com' };

  it('treats a user WITH a session as signed in', () => {
    expect(interpretSignUp({ user, session: { access_token: 't' } })).toEqual({ kind: 'signed-in' });
  });

  it('treats a user WITHOUT a session as awaiting email confirmation (Supabase sends no session until the link is clicked)', () => {
    expect(interpretSignUp({ user, session: null })).toEqual({ kind: 'confirm-email', email: 'ana@example.com' });
  });

  it.each([[null], [undefined], [{}], [{ user: null, session: null }]])('reports failure for %j', (data) => {
    expect(interpretSignUp(data)).toEqual({ kind: 'failed' });
  });
});
