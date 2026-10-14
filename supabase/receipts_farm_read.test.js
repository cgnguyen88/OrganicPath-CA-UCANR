import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, signUp, asUser, asAnon, farmIdOf, migrationSql } from './harness.js';

// Receipt photos from the old Receipt Manager are filed under the uploader's user id. The purchase record made
// from a receipt is visible to the whole farm, so the photo has to be as well, and to nobody else: the photos
// that belong to a receipt of the farm (by the receipt row), not everything its members ever uploaded.
describe('migration: farm members can open each other’s receipt photos', () => {
  let db;
  let owner; let crew; let outsider; let loner;
  let farmA; let farmB;
  beforeAll(async () => {
    db = await freshDb();
    owner = await signUp(db, { email: 'rr-owner@example.com' });
    crew = await signUp(db, { email: 'rr-crew@example.com' });
    outsider = await signUp(db, { email: 'rr-outsider@example.com' });
    loner = await signUp(db, { email: 'rr-loner@example.com' });
    farmA = await farmIdOf(db, owner);
    farmB = await farmIdOf(db, outsider);
    await db.query('delete from public.farm_members where user_id = $1', [crew]);
    await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1, $2, 'crew')`, [farmA, crew]);
    await db.query('delete from public.farm_members where user_id = $1', [loner]);
    // Files are uploaded by their owners (the table owner stands in for the upload).
    await db.query(
      `insert into storage.objects (bucket_id, name, owner) values
         ('receipts', $1, $2), ('receipts', $3, $4), ('receipts', $5, $6), ('receipts', $7, $8)`,
      [`${owner}/a.png`, owner, `${crew}/b.png`, crew, `${outsider}/c.png`, outsider, `${loner}/d.png`, loner],
    );
    // Each photo is named by a receipt of the farm it belongs to (the table owner stands in for the app).
    await db.query(
      `insert into public.receipts (user_id, farm_id, supplier, product, file_path) values
         ($1, $2, 'S', 'a', $3), ($4, $2, 'S', 'b', $5), ($6, $7, 'S', 'c', $8)`,
      [owner, farmA, `${owner}/a.png`, crew, `${crew}/b.png`, outsider, farmB, `${outsider}/c.png`],
    );
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('record-files', $1, $2), ('record-files', $3, $4)`, [`${farmA}/k/0.jpg`, owner, `${farmB}/k/0.jpg`, outsider]);
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  const seen = (userId, bucket = 'receipts') => asUser(db, userId, async () => (await db.query(`select name from storage.objects where bucket_id = $1 order by name`, [bucket])).rows.map((r) => r.name));
  const sorted = (...names) => [...names].sort();

  it('lets a member open their own photos and those of the others in their farm', async () => {
    expect(await seen(owner)).toEqual(sorted(`${owner}/a.png`, `${crew}/b.png`));
    expect(await seen(crew)).toEqual(sorted(`${owner}/a.png`, `${crew}/b.png`));
  });

  it('keeps another farm’s photos closed', async () => {
    expect(await seen(outsider)).toEqual([`${outsider}/c.png`]);
    expect(await seen(owner)).not.toContain(`${outsider}/c.png`);
    expect(await seen(crew)).not.toContain(`${outsider}/c.png`);
  });

  it('lets someone who is in no farm open only their own photos', async () => {
    expect(await seen(loner)).toEqual([`${loner}/d.png`]);
  });

  it('shows signed-out visitors nothing', async () => {
    expect(await asAnon(db, async () => (await db.query(`select name from storage.objects where bucket_id = 'receipts'`)).rows)).toHaveLength(0);
  });

  it('keeps a farm’s receipt photos with the farm when the person who uploaded them leaves it, and closes them to that person', async () => {
    const temp = await signUp(db, { email: 'rr-temp@example.com' });
    await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1, $2, 'crew')`, [farmA, temp]);
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${temp}/t.png`, temp]);
    await db.query(`insert into public.receipts (user_id, farm_id, supplier, product, file_path) values ($1, $2, 'S', 't', $3)`, [temp, farmA, `${temp}/t.png`]);
    expect(await seen(owner)).toContain(`${temp}/t.png`);
    await db.query('delete from public.farm_members where user_id = $1 and farm_id = $2', [temp, farmA]);
    expect(await seen(owner)).toContain(`${temp}/t.png`); // the receipt, and its purchase record, still belong to the farm
    expect(await seen(temp)).toEqual([`${temp}/t.png`]); // and the uploader still has their own folder
  });

  it('keeps a file that no receipt of the farm names to its uploader, even for someone in the same farm', async () => {
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${crew}/unnamed.png`, crew]);
    expect(await seen(crew)).toContain(`${crew}/unnamed.png`);
    expect(await seen(owner)).not.toContain(`${crew}/unnamed.png`);
  });

  it('never shares a photo with a farm other than the one its receipt belongs to, even when the uploader is in both', async () => {
    const both = await signUp(db, { email: 'rr-both@example.com' });
    const bothOwnFarm = await farmIdOf(db, both);
    await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1, $2, 'crew')`, [farmA, both]);
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${both}/own-farm-only.png`, both]);
    await db.query(`insert into public.receipts (user_id, farm_id, supplier, product, file_path) values ($1, $2, 'S', 'x', $3)`, [both, bothOwnFarm, `${both}/own-farm-only.png`]);
    expect(await seen(owner)).not.toContain(`${both}/own-farm-only.png`); // owner shares farm A with them, but the receipt is the other farm's
  });

  it('does not let anyone write into, replace or delete another member’s folder', async () => {
    await expect(asUser(db, crew, () => db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${owner}/planted.png`, crew]))).rejects.toThrow(/row-level security/i);
    const deleted = await asUser(db, crew, () => db.query(`delete from storage.objects where bucket_id = 'receipts' and name = $1 returning name`, [`${owner}/a.png`]));
    expect(deleted.rows).toHaveLength(0);
    expect(await seen(owner)).toContain(`${owner}/a.png`);
  });

  it('lets a member still add and remove their own photos', async () => {
    await asUser(db, crew, () => db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${crew}/new.png`, crew]));
    expect(await seen(crew)).toContain(`${crew}/new.png`);
    expect(await seen(owner)).not.toContain(`${crew}/new.png`); // not until a receipt of the farm names it
    await db.query(`insert into public.receipts (user_id, farm_id, supplier, product, file_path) values ($1, $2, 'S', 'n', $3)`, [crew, farmA, `${crew}/new.png`]);
    expect(await seen(owner)).toContain(`${crew}/new.png`);
    const deleted = await asUser(db, crew, () => db.query(`delete from storage.objects where bucket_id = 'receipts' and name = $1 returning name`, [`${crew}/new.png`]));
    expect(deleted.rows).toHaveLength(1);
  });

  it('does not change who can open the files the assistant stored', async () => {
    expect(await seen(owner, 'record-files')).toEqual([`${farmA}/k/0.jpg`]);
    expect(await seen(outsider, 'record-files')).toEqual([`${farmB}/k/0.jpg`]);
  });

  it('opens nothing in other buckets', async () => {
    await db.query(`insert into storage.buckets (id, name, public) values ('other', 'other', false) on conflict do nothing`);
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('other', $1, $2)`, [`${crew}/x.png`, crew]);
    expect(await seen(owner, 'other')).toEqual([]);
  });

  it('cannot be used to open someone else’s photo by writing its path on a receipt of your own farm', async () => {
    // The receipt's file_path is typed by whoever adds the receipt: it must not let them claim another person's file.
    await asUser(db, outsider, () => db.query(`insert into public.receipts (user_id, farm_id, supplier, product, file_path) values ($1, $2, 'S', 'claim', $3)`, [outsider, farmB, `${owner}/a.png`]));
    expect(await seen(outsider)).toEqual([`${outsider}/c.png`]);
    expect(await seen(outsider)).not.toContain(`${owner}/a.png`);
    await asUser(db, crew, () => db.query(`insert into public.receipts (user_id, farm_id, supplier, product, file_path) values ($1, $2, 'S', 'claim2', $3)`, [crew, farmA, `${outsider}/c.png`]));
    expect(await seen(crew)).not.toContain(`${outsider}/c.png`);
  });

  it('has an index for finding a receipt by its file', async () => {
    const { rows } = await db.query(`select 1 from pg_indexes where schemaname = 'public' and tablename = 'receipts' and indexdef ilike '%(file_path)%'`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('has one policy of its own for this, pinned to the receipts bucket without OR or NOT', async () => {
    const { rows } = await db.query(`select policyname, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_objects_select_farm'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toMatch(/bucket_id\s*=\s*'receipts'/);
    expect(rows[0].qual).not.toMatch(/\b(or|not)\b/i);
  });

  it('is safe to apply again', async () => {
    const sql = migrationSql().find((text) => text.includes('receipts_objects_select_farm'));
    expect(sql).toBeTruthy();
    const before = await seen(owner);
    await db.exec(sql);
    await db.exec(sql);
    expect(await seen(owner)).toEqual(before);
    expect(before).toEqual(expect.arrayContaining([`${owner}/a.png`, `${crew}/b.png`]));
    const { rows } = await db.query(`select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts_objects_select_farm'`);
    expect(rows).toHaveLength(1);
  });
});
