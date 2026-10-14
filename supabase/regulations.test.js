import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, signUp, asUser, asAnon } from './harness.js';

// SYNTHETIC passages for exercising search mechanics only. They are not regulation text.
const FIXTURE = [
  ['205.900', '205.900(a)', 'Test section alpha', 'Zorbium sulfate is allowed as a synthetic substance when used as a plant nutrient.', 1],
  ['205.900', '205.900(b)', 'Test section alpha', 'Quillon oil is prohibited in crop production under this fixture.', 2],
  ['205.901', '205.901(a)', 'Test section beta', 'Records for zorbium sulfate must be kept for five years.', 1],
  ['205.902', '205.902', 'Quillon notes', 'Nothing relevant here.', 1],
];

describe('Phase 2 migration: regulation_chunks and search_regulations', () => {
  let db; let user;
  beforeAll(async () => {
    db = await freshDb();
    user = await signUp(db, { email: 'reg@example.com' });
    for (const [section, anchor, heading, body, ord] of FIXTURE) {
      await db.query(
        `insert into public.regulation_chunks (part, section, anchor, citation, heading, body, ord, source_url, version_date)
         values ('205', $1, $2, $3, $4, $5, $6, 'https://example.test/' || $1, '2026-10-01')`,
        [section, anchor, `7 CFR ${anchor}`, heading, body, ord],
      );
    }
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  const search = (query, max) =>
    asUser(db, user, async () => (await db.query('select * from public.search_regulations($1, $2)', [query, max])).rows);

  it('returns ranked passages with their citation and source', async () => {
    const rows = await search('zorbium sulfate');
    expect(rows.map((r) => r.citation).sort()).toEqual(['7 CFR 205.900(a)', '7 CFR 205.901(a)']);
    expect(rows[0]).toMatchObject({ source_url: expect.stringMatching(/^https:\/\/example\.test\//) });
    expect(rows[0].rank).toBeGreaterThanOrEqual(rows[1].rank);
  });

  it('weights headings above body text', async () => {
    const rows = await search('quillon');
    expect(rows[0].citation).toBe('7 CFR 205.902'); // heading hit outranks the body-only hit
    expect(rows).toHaveLength(2);
  });

  it('finds nothing for an unrelated or empty query, and never errors on odd syntax', async () => {
    expect(await search('platypus')).toEqual([]);
    expect(await search('')).toEqual([]);
    expect(await search(null)).toEqual([]);
    for (const hostile of ["'; drop table x; --", '& | ! ( ) :*', '"unbalanced quote', 'a'.repeat(5000)]) {
      await expect(search(hostile)).resolves.toBeInstanceOf(Array);
    }
  });

  it('falls back to matching any word when no passage has all of them (natural-language questions)', async () => {
    const rows = await search('how long must zorbium records be retained');
    expect(rows.map((r) => r.citation)).toContain('7 CFR 205.901(a)');
    // Words that never appear together still find each word's passages instead of nothing.
    const either = await search('zorbium quillon');
    expect(either.map((r) => r.citation).sort()).toEqual(['7 CFR 205.900(a)', '7 CFR 205.900(b)', '7 CFR 205.901(a)', '7 CFR 205.902']);
  });

  it('does not broaden a query that already has exact matches', async () => {
    const rows = await search('zorbium sulfate');
    expect(rows.map((r) => r.citation).sort()).toEqual(['7 CFR 205.900(a)', '7 CFR 205.901(a)']);
  });

  it('caps how many passages come back', async () => {
    expect(await search('section OR notes OR zorbium OR quillon', 1)).toHaveLength(1);
    expect((await search('zorbium', 0)).length).toBe(1); // below 1 is raised to 1
    expect((await search('zorbium', 9999)).length).toBe(2); // above 20 is clamped (only 2 exist)
  });

  it('is readable by signed-in users and hidden from signed-out visitors', async () => {
    expect(await asUser(db, user, async () => (await db.query('select count(*)::int as n from public.regulation_chunks')).rows[0].n)).toBe(4);
    await expect(asAnon(db, () => db.query('select * from public.regulation_chunks'))).rejects.toThrow(/permission denied/i);
    await expect(asAnon(db, () => db.query(`select * from public.search_regulations('zorbium')`))).rejects.toThrow(/permission denied/i);
  });

  it('denies signed-out roles at both layers: the table and the function', async () => {
    const { rows } = await db.query(`select
      has_function_privilege('anon', 'public.search_regulations(text, integer)', 'execute') as anon_fn,
      has_function_privilege('authenticated', 'public.search_regulations(text, integer)', 'execute') as authed_fn,
      has_table_privilege('anon', 'public.regulation_chunks', 'select') as anon_table`);
    expect(rows[0]).toEqual({ anon_fn: false, authed_fn: true, anon_table: false });
  });

  it('cannot be written through the client API', async () => {
    await expect(asUser(db, user, () => db.query(`insert into public.regulation_chunks (part, section, anchor, citation, heading, body, ord, version_date) values ('205','x','x','x','x','x',1,'2026-10-01')`))).rejects.toThrow(/permission denied/i);
    await expect(asUser(db, user, () => db.query(`update public.regulation_chunks set body = 'tampered'`))).rejects.toThrow(/permission denied/i);
    await expect(asUser(db, user, () => db.query(`delete from public.regulation_chunks`))).rejects.toThrow(/permission denied/i);
  });

  it('keeps one row per citation and version, and bounds chunk size', async () => {
    await expect(db.query(`insert into public.regulation_chunks (part, section, anchor, citation, heading, body, ord, version_date) values ('205','205.900','205.900(a)','7 CFR 205.900(a)','dup','dup',9,'2026-10-01')`)).rejects.toThrow(/unique|duplicate/i);
    await expect(db.query(`insert into public.regulation_chunks (part, section, anchor, citation, heading, body, ord, version_date) values ('205','205.1','205.1','7 CFR 205.1','h','${'x'.repeat(8001)}',1,'2026-10-01')`)).rejects.toThrow(/body_size|check/i);
  });

  it('is safe to re-run', async () => {
    const sql = (await import('./harness.js')).migrationSql().at(-1);
    await db.exec(sql);
    expect((await search('zorbium')).length).toBe(2);
  });
});
