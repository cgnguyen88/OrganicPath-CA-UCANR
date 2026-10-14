import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, signUp, asUser, asAnon, asServiceRole } from './harness.js';

describe('Phase 2 migration: durable rate limits', () => {
  let db; let user;
  beforeAll(async () => {
    db = await freshDb();
    user = await signUp(db, { email: 'rl@example.com' });
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  const take = (bucket, subject, max, windowSeconds) =>
    asServiceRole(db, async () => (await db.query('select * from public.take_rate_token($1, $2, $3, $4)', [bucket, subject, max, windowSeconds])).rows[0]);
  const hits = async (bucket, subject) => Number((await db.query('select count(*) from public.rate_limit_hits where bucket = $1 and subject = $2', [bucket, subject])).rows[0].count);

  it('allows up to the maximum, then blocks with a retry delay', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await take('t-basic', 'u1', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[0].retry_after_sec).toBe(0);
    expect(results[3].retry_after_sec).toBeGreaterThanOrEqual(1);
    expect(results[3].retry_after_sec).toBeLessThanOrEqual(60);
  });

  it('does not record blocked attempts, so hammering cannot extend a lockout or grow the table', async () => {
    await take('t-hammer', 'u1', 1, 60);
    for (let i = 0; i < 10; i += 1) await take('t-hammer', 'u1', 1, 60);
    expect(await hits('t-hammer', 'u1')).toBe(1);
  });

  it('counts each bucket and each subject separately', async () => {
    await take('t-a', 'u1', 1, 60);
    expect((await take('t-a', 'u2', 1, 60)).allowed).toBe(true);
    expect((await take('t-b', 'u1', 1, 60)).allowed).toBe(true);
    expect((await take('t-a', 'u1', 1, 60)).allowed).toBe(false);
  });

  it('frees capacity once hits age out of the window, and tidies expired rows', async () => {
    await take('t-age', 'u1', 1, 60);
    await db.exec(`update public.rate_limit_hits set hit_at = now() - interval '61 seconds' where bucket = 't-age'`);
    expect((await take('t-age', 'u1', 1, 60)).allowed).toBe(true);
    expect(await hits('t-age', 'u1')).toBe(1); // the stale row was removed
  });

  it.each([
    ['zero max', ['t-bad', 'u', 0, 60]],
    ['absurd max', ['t-bad', 'u', 1_000_001, 60]],
    ['zero window', ['t-bad', 'u', 5, 0]],
    ['window over a day', ['t-bad', 'u', 5, 86_401]],
    ['bad bucket name', ['Bad Bucket!', 'u', 5, 60]],
    ['empty subject', ['t-bad', '', 5, 60]],
  ])('rejects %s', async (_n, args) => {
    await expect(take(...args)).rejects.toThrow();
  });

  it('is callable only by the server role: not by signed-in users, not by anyone signed out', async () => {
    await expect(asUser(db, user, () => db.query(`select * from public.take_rate_token('t-x', 'u', 5, 60)`))).rejects.toThrow(/permission denied/i);
    await expect(asAnon(db, () => db.query(`select * from public.take_rate_token('t-x', 'u', 5, 60)`))).rejects.toThrow(/permission denied/i);
    const { rows } = await db.query(`select
      has_function_privilege('authenticated', 'public.take_rate_token(text,text,integer,integer)', 'execute') as authed,
      has_function_privilege('anon', 'public.take_rate_token(text,text,integer,integer)', 'execute') as anon,
      has_function_privilege('service_role', 'public.take_rate_token(text,text,integer,integer)', 'execute') as service`);
    expect(rows[0]).toEqual({ authed: false, anon: false, service: true });
  });

  it('keeps the hit log out of reach of users', async () => {
    await expect(asUser(db, user, () => db.query('select * from public.rate_limit_hits'))).rejects.toThrow(/permission denied/i);
    await expect(asUser(db, user, () => db.query(`delete from public.rate_limit_hits`))).rejects.toThrow(/permission denied/i);
  });

  it('tidies itself: taking a token also clears a few long-expired hits of other people', async () => {
    await db.query(`insert into public.rate_limit_hits (bucket, subject, hit_at) values ('t-ghost', 'gone', now() - interval '5 days')`);
    await take('t-fresh', 'u1', 5, 60);
    expect(await hits('t-ghost', 'gone')).toBe(0);
  });

  it('purges old rows on request, for the server role only', async () => {
    await take('t-old', 'u1', 5, 60);
    await db.exec(`update public.rate_limit_hits set hit_at = now() - interval '3 days' where bucket = 't-old'`);
    const purged = await asServiceRole(db, async () => (await db.query('select public.purge_rate_limit_hits() as n')).rows[0].n);
    expect(Number(purged)).toBeGreaterThanOrEqual(1);
    expect(await hits('t-old', 'u1')).toBe(0);
    await expect(asUser(db, user, () => db.query('select public.purge_rate_limit_hits()'))).rejects.toThrow(/permission denied/i);
  });

  it('is safe to re-run', async () => {
    const sql = (await import('./harness.js')).migrationSql().at(-1);
    await db.exec(sql);
    expect((await take('t-rerun', 'u1', 1, 60)).allowed).toBe(true);
  });

  it('serializes concurrent callers so the limit cannot be overshot', async () => {
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => take('t-race', 'u1', 3, 60)));
    expect(outcomes.filter((r) => r.allowed)).toHaveLength(3);
  });
});
