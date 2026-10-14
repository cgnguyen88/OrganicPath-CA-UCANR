import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, signUp, asUser, asAnon, farmIdOf } from './harness.js';

describe('Phase 2 migration: record-files bucket', () => {
  let db;
  let a; let b; let farmA; let farmB;
  beforeAll(async () => {
    db = await freshDb();
    a = await signUp(db, { email: 'rf-a@example.com' });
    b = await signUp(db, { email: 'rf-b@example.com' });
    farmA = await farmIdOf(db, a);
    farmB = await farmIdOf(db, b);
    // The server (service role / table owner) files two captures.
    await db.query(`insert into storage.objects (bucket_id, name) values ('record-files', $1), ('record-files', $2), ('record-files', 'not-a-uuid/x.png')`, [`${farmA}/k1/0.jpg`, `${farmB}/k2/0.jpg`]);
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  const namesSeenBy = (userId) => asUser(db, userId, async () => (await db.query(`select name from storage.objects where bucket_id = 'record-files' order by name`)).rows.map((r) => r.name));

  it('creates a private bucket with a size cap and an allow-list of file types', async () => {
    const { rows } = await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'record-files'`);
    expect(rows[0].public).toBe(false);
    expect(Number(rows[0].file_size_limit)).toBe(5 * 1024 * 1024);
    expect([...rows[0].allowed_mime_types].sort()).toEqual(['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
  });

  it('lets a member read their own farm’s files and nobody else’s', async () => {
    expect(await namesSeenBy(a)).toEqual([`${farmA}/k1/0.jpg`]);
    expect(await namesSeenBy(b)).toEqual([`${farmB}/k2/0.jpg`]);
  });

  it('shows signed-out visitors nothing', async () => {
    expect(await asAnon(db, async () => (await db.query(`select name from storage.objects where bucket_id = 'record-files'`)).rows)).toHaveLength(0);
  });

  it('does not let a user who is in no farm see anything', async () => {
    const loner = await signUp(db, { email: 'rf-none@example.com' });
    await db.query('delete from public.farm_members where user_id = $1', [loner]);
    expect(await namesSeenBy(loner)).toEqual([]);
  });

  it('gives clients no way to write: upload, overwrite or delete', async () => {
    await expect(asUser(db, a, () => db.query(`insert into storage.objects (bucket_id, name, owner) values ('record-files', $1, $2)`, [`${farmA}/evil/0.jpg`, a]))).rejects.toThrow(/row-level security/i);
    const updated = await asUser(db, a, () => db.query(`update storage.objects set name = $1 where bucket_id = 'record-files' and name = $2 returning name`, [`${farmA}/k1/renamed.jpg`, `${farmA}/k1/0.jpg`]));
    expect(updated.rows).toHaveLength(0);
    const deleted = await asUser(db, a, () => db.query(`delete from storage.objects where bucket_id = 'record-files' returning name`));
    expect(deleted.rows).toHaveLength(0);
    expect(await namesSeenBy(a)).toEqual([`${farmA}/k1/0.jpg`]);
  });

  it('does not widen access to the receipts bucket', async () => {
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${farmB}/r.png`, b]);
    const seen = await asUser(db, a, async () => (await db.query(`select name from storage.objects where bucket_id = 'receipts'`)).rows);
    expect(seen).toHaveLength(0);
  });

  it('is safe to re-run', async () => {
    const sql = (await import('./harness.js')).migrationSql().at(-1);
    await db.exec(sql);
    expect(await namesSeenBy(a)).toEqual([`${farmA}/k1/0.jpg`]);
    const { rows } = await db.query(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'record_files%'`);
    expect(rows).toHaveLength(1);
  });

  it('flips a pre-existing public bucket of that name to private and re-applies the limits', async () => {
    const isolated = await freshDb({
      seed: false,
      legacySql: `insert into storage.buckets (id, name, public, file_size_limit) values ('record-files', 'record-files', true, 999999999);`,
    });
    try {
      const { rows } = await isolated.query(`select public, file_size_limit from storage.buckets where id = 'record-files'`);
      expect(rows[0].public).toBe(false);
      expect(Number(rows[0].file_size_limit)).toBe(5 * 1024 * 1024);
    } finally {
      await isolated.close();
    }
  });

  describe('legacy policies', () => {
    it('drops a legacy policy that names the bucket (it would be OR-ed in), keeping unrelated ones', async () => {
      const isolated = await freshDb({
        seed: false,
        legacySql: `create policy legacy_rf on storage.objects for select to authenticated using (bucket_id = 'record-files');`,
      });
      try {
        expect((await isolated.query(`select 1 from pg_policies where policyname = 'legacy_rf'`)).rows).toHaveLength(0);
        expect((await isolated.query(`select 1 from pg_policies where policyname = 'archive_read'`)).rows).toHaveLength(1);
      } finally {
        await isolated.close();
      }
    });

    it('refuses to apply next to a wide-open policy that could expose the bucket', async () => {
      await expect(freshDb({ seed: false, legacySql: `create policy legacy_open_read on storage.objects for select using (true);` })).rejects.toThrow(/Cannot apply: storage\.objects has permissive/i);
    });
  });
});
