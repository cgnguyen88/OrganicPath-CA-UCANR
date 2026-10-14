import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, signUp, asUser, asAnon, farmIdOf, migrationSql } from './harness.js';

// Fields: the named places a farm grows things. Records keep the field as text, so the registry must never let
// a name change or vanish while records still use it: that would quietly break the trail from a harvest back
// to a field. Names are unique per farm, ignoring capital letters.
describe('migration: fields', () => {
  let db;
  let owner; let manager; let crew; let outsider; let loner;
  let farmA; let farmB;

  beforeAll(async () => {
    db = await freshDb();
    owner = await signUp(db, { email: 'f-owner@example.com' });
    manager = await signUp(db, { email: 'f-manager@example.com' });
    crew = await signUp(db, { email: 'f-crew@example.com' });
    outsider = await signUp(db, { email: 'f-outsider@example.com' });
    loner = await signUp(db, { email: 'f-loner@example.com' });
    farmA = await farmIdOf(db, owner);
    farmB = await farmIdOf(db, outsider);
    for (const user of [manager, crew]) await db.query('delete from public.farm_members where user_id = $1', [user]);
    await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'crew')`, [farmA, manager, crew]);
    await db.query('delete from public.farm_members where user_id = $1', [loner]);
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  const as = (user, sql, params = []) => asUser(db, user, () => db.query(sql, params));
  const addField = (user, farm, name, extra = {}) =>
    as(user, `insert into public.fields (farm_id, name, area, area_unit, notes) values ($1, $2, $3, $4, $5) returning id, name, is_active`, [farm, name, extra.area ?? null, extra.area_unit ?? null, extra.notes ?? null]);
  const namesSeenBy = (user, farm) => asUser(db, user, async () => (await db.query('select name from public.fields where farm_id = $1 order by lower(name)', [farm])).rows.map((r) => r.name));
  // A record that uses a field. Records are filed by the table owner here, which is what the server does.
  const fileRecord = (farm, field, extra = {}) =>
    db.query(
      `insert into public.records (farm_id, kind, status, record_date, payload, created_by) values ($1, $2, $3, '2026-05-01', $4::jsonb, $5)`,
      [farm, extra.kind ?? 'activity', extra.status ?? 'approved', JSON.stringify({ activity_type: 'irrigation', field, ...(extra.payload ?? {}) }), owner],
    );

  describe('who can see and change fields', () => {
    it('lets an owner and a manager add fields, with an area, a unit and notes', async () => {
      const a = await addField(owner, farmA, 'B2', { area: 2.5, area_unit: 'acre', notes: 'North of the barn' });
      expect(a.rows[0]).toMatchObject({ name: 'B2', is_active: true });
      await addField(manager, farmA, 'A1');
    });

    it('lets every member of the farm see them, and nobody else', async () => {
      await addField(outsider, farmB, 'Other farm field');
      expect(await namesSeenBy(owner, farmA)).toEqual(['A1', 'B2']);
      expect(await namesSeenBy(crew, farmA)).toEqual(['A1', 'B2']);
      expect(await namesSeenBy(outsider, farmA)).toEqual([]);
      expect(await namesSeenBy(outsider, farmB)).toEqual(['Other farm field']);
      expect(await namesSeenBy(loner, farmA)).toEqual([]);
    });

    it('shows signed-out visitors nothing, and lets them change nothing', async () => {
      await expect(asAnon(db, () => db.query('select * from public.fields'))).rejects.toThrow(/permission denied/i);
      await expect(asAnon(db, () => db.query(`insert into public.fields (farm_id, name) values ($1, 'x')`, [farmA]))).rejects.toThrow(/permission denied|row-level security/i);
    });

    it('does not let crew add, change, archive or delete a field', async () => {
      await expect(addField(crew, farmA, 'Crew field')).rejects.toThrow(/row-level security/i);
      const updated = await as(crew, `update public.fields set notes = 'x' where farm_id = $1 returning id`, [farmA]);
      expect(updated.rows).toHaveLength(0);
      const deleted = await as(crew, `delete from public.fields where farm_id = $1 returning id`, [farmA]);
      expect(deleted.rows).toHaveLength(0);
    });

    it('does not let anyone add a field to another farm', async () => {
      await expect(addField(owner, farmB, 'Planted in the wrong farm')).rejects.toThrow(/row-level security/i);
      await expect(addField(loner, farmA, 'Not a member')).rejects.toThrow(/row-level security/i);
    });

    it('does not let a field be moved to another farm, or its author be changed', async () => {
      await expect(as(owner, `update public.fields set farm_id = $1 where farm_id = $2`, [farmB, farmA])).rejects.toThrow(/permission denied/i);
      await expect(as(owner, `update public.fields set created_by = $1 where farm_id = $2`, [crew, farmA])).rejects.toThrow(/permission denied/i);
    });

    it('does not let a field move to another farm even for something that bypasses the column permissions', async () => {
      await expect(db.query(`update public.fields set farm_id = $1 where farm_id = $2 and name = 'A1'`, [farmB, farmA])).rejects.toThrow(/cannot move to another farm/i);
      expect(await namesSeenBy(owner, farmA)).toContain('A1');
    });

    it('does not let a manager touch another farm’s fields', async () => {
      const updated = await as(manager, `update public.fields set notes = 'x' where farm_id = $1 returning id`, [farmB]);
      expect(updated.rows).toHaveLength(0);
      const deleted = await as(manager, `delete from public.fields where farm_id = $1 returning id`, [farmB]);
      expect(deleted.rows).toHaveLength(0);
      expect(await namesSeenBy(outsider, farmB)).toEqual(['Other farm field']);
    });

    it('records who added a field, as the signed-in person, and cannot be told otherwise', async () => {
      const { rows } = await db.query(`select created_by from public.fields where farm_id = $1 and name = 'A1'`, [farmA]);
      expect(rows[0].created_by).toBe(manager);
      await expect(as(owner, `insert into public.fields (farm_id, name, created_by) values ($1, 'Forged', $2)`, [farmA, crew])).rejects.toThrow(/permission denied/i);
    });
  });

  describe('names', () => {
    it('are unique within a farm, ignoring capital letters', async () => {
      await expect(addField(owner, farmA, 'b2')).rejects.toThrow(/duplicate key|unique/i);
      await expect(addField(manager, farmA, 'B2')).rejects.toThrow(/duplicate key|unique/i);
    });

    it('can be the same in two different farms', async () => {
      await addField(outsider, farmB, 'B2');
      expect(await namesSeenBy(outsider, farmB)).toContain('B2');
    });

    it.each([
      ['empty', ''],
      ['only spaces', '   '],
      ['with a space at the start', ' North'],
      ['with a space at the end', 'North '],
      ['too long', 'x'.repeat(61)],
      ['with a line break', 'North\n40'],
      ['with a tab', 'North\t40'],
      ['with a control character', 'North\u0007'],
    ])('refuse a name that is %s', async (_label, name) => {
      await expect(addField(owner, farmA, name)).rejects.toThrow(/check constraint|violates/i);
    });

    it.each([
      ['two spaces inside', 'North  40'],
      ['a non-breaking space', 'North\u00a040'],
      ['an ideographic space', 'North\u300040'],
      ['a zero-width space', 'Z\u200b9'],
      ['a text-direction override', 'North\u202e40'],
      ['a left-to-right mark', 'North\u200e40'],
      ['a byte-order mark inside', 'North\ufeff40'],
    ])('refuse a name with %s, because the app would tidy it to something else', async (_label, name) => {
      await expect(addField(owner, farmA, name)).rejects.toThrow(/check constraint|violates/i);
    });

    it('treat names that differ only in spacing as the same name', async () => {
      await addField(owner, farmA, 'Spacing test 1');
      await expect(addField(owner, farmA, 'spacing TEST 1')).rejects.toThrow(/duplicate key|unique/i);
    });

    it('allow a name of exactly 60 characters, spaces inside, accents and other scripts', async () => {
      for (const name of ['x'.repeat(60), 'North 40', 'Campo Año Nuevo', '北の畑']) await addField(owner, farmA, name);
      expect(await namesSeenBy(owner, farmA)).toEqual(expect.arrayContaining(['North 40', 'Campo Año Nuevo', '北の畑']));
    });
  });

  describe('area and notes', () => {
    it.each([
      ['a negative area', { area: -1, area_unit: 'acre' }],
      ['an enormous area', { area: 1e7, area_unit: 'acre' }],
      ['an unknown unit', { area: 1, area_unit: 'furlong' }],
      ['notes that are too long', { notes: 'n'.repeat(1001) }],
    ])('refuse %s', async (_label, extra) => {
      await expect(addField(owner, farmA, `Bad ${_label}`, extra)).rejects.toThrow(/check constraint|violates/i);
    });

    it('allow no area at all, an area of zero, and the three units', async () => {
      await addField(owner, farmA, 'No area');
      await addField(owner, farmA, 'Zero', { area: 0, area_unit: 'acre' });
      await addField(owner, farmA, 'Hectares', { area: 1.5, area_unit: 'hectare' });
      await addField(owner, farmA, 'Square feet', { area: 4000, area_unit: 'sq_ft' });
    });
  });

  describe('while records use a field', () => {
    beforeAll(async () => {
      await addField(owner, farmA, 'In use');
      await addField(owner, farmA, 'In use only by a voided record');
      await addField(owner, farmA, 'Free');
      await fileRecord(farmA, 'in use');
      await fileRecord(farmA, 'In use only by a voided record', { status: 'voided' });
    });

    it('cannot be renamed, however the records spell it', async () => {
      await expect(as(owner, `update public.fields set name = 'Renamed' where farm_id = $1 and name = 'In use'`, [farmA])).rejects.toThrow(/used by records/i);
      await expect(as(manager, `update public.fields set name = 'Renamed' where farm_id = $1 and name = 'In use only by a voided record'`, [farmA])).rejects.toThrow(/used by records/i);
    });

    it.each([
      ['two spaces inside', (base) => base.replace(' ', '  ')],
      ['spaces around it', (base) => `  ${base}  `],
      ['a non-breaking space', (base) => base.replace(' ', '\u00a0')],
      ['a tab', (base) => base.replace(' ', '\t')],
      ['a zero-width space', (base) => base.replace(' ', '\u200b ')],
      ['other capital letters', (base) => base.toUpperCase()],
    ])('counts a record that spells the field with %s as using it', async (label, spell) => {
      const base = `Spaced ${label.length}${label[0]}`;
      await addField(owner, farmA, base);
      await fileRecord(farmA, spell(base));
      await expect(as(owner, `update public.fields set name = $2 where farm_id = $1 and name = $3`, [farmA, `${base} renamed`, base])).rejects.toThrow(/used by records/i);
      await expect(as(owner, `delete from public.fields where farm_id = $1 and name = $2`, [farmA, base])).rejects.toThrow(/used by records/i);
    });

    it('is not slowed or broken by a record with a huge field value, or one that is not text', async () => {
      await fileRecord(farmA, 'long '.repeat(2000));
      await db.query(`update public.records set payload = payload || '{"field": {"a": 1}}'::jsonb where farm_id = $1 and payload->>'field' like 'long %'`, [farmA]);
      await fileRecord(farmA, 'z'.repeat(5000));
      await addField(owner, farmA, 'Huge test');
      const deleted = await as(owner, `delete from public.fields where farm_id = $1 and name = 'Huge test' returning id`, [farmA]);
      expect(deleted.rows).toHaveLength(1);
    });

    it('can have its capital letters changed, since records match it that way anyway', async () => {
      await as(owner, `update public.fields set name = 'IN USE' where farm_id = $1 and name = 'In use'`, [farmA]);
      expect(await namesSeenBy(owner, farmA)).toContain('IN USE');
      await as(owner, `update public.fields set name = 'In use' where farm_id = $1 and name = 'IN USE'`, [farmA]);
    });

    it('cannot be deleted, not even when only a voided record uses it', async () => {
      await expect(as(owner, `delete from public.fields where farm_id = $1 and name = 'In use'`, [farmA])).rejects.toThrow(/used by records/i);
      await expect(as(owner, `delete from public.fields where farm_id = $1 and name = 'In use only by a voided record'`, [farmA])).rejects.toThrow(/used by records/i);
    });

    it('can be archived and restored, and have its area and notes changed', async () => {
      const archived = await as(manager, `update public.fields set is_active = false, notes = 'No longer farmed', area = 3, area_unit = 'acre' where farm_id = $1 and name = 'In use' returning is_active`, [farmA]);
      expect(archived.rows[0].is_active).toBe(false);
      const restored = await as(manager, `update public.fields set is_active = true where farm_id = $1 and name = 'In use' returning is_active`, [farmA]);
      expect(restored.rows[0].is_active).toBe(true);
    });

    it('does not count another farm’s records', async () => {
      await fileRecord(farmB, 'Free');
      const renamed = await as(owner, `update public.fields set name = 'Free (renamed)' where farm_id = $1 and name = 'Free' returning name`, [farmA]);
      expect(renamed.rows).toHaveLength(1);
      await as(owner, `update public.fields set name = 'Free' where farm_id = $1 and name = 'Free (renamed)'`, [farmA]);
    });

    it('can be renamed or deleted once no record uses it', async () => {
      const renamed = await as(owner, `update public.fields set name = 'Free two' where farm_id = $1 and name = 'Free' returning name`, [farmA]);
      expect(renamed.rows[0].name).toBe('Free two');
      const deleted = await as(owner, `delete from public.fields where farm_id = $1 and name = 'Free two' returning id`, [farmA]);
      expect(deleted.rows).toHaveLength(1);
    });

    it('cannot be renamed to a name another field already has', async () => {
      await expect(as(owner, `update public.fields set name = 'a1' where farm_id = $1 and name = 'Zero'`, [farmA])).rejects.toThrow(/duplicate key|unique/i);
    });

    it('is not fooled by a record whose field is not text, or has none', async () => {
      await addField(owner, farmA, 'Numeric');
      await db.query(`insert into public.records (farm_id, kind, status, record_date, payload, created_by) values ($1, 'activity', 'approved', '2026-05-01', '{"activity_type":"irrigation","field":5}'::jsonb, $2)`, [farmA, owner]);
      await db.query(`insert into public.records (farm_id, kind, status, record_date, payload, created_by) values ($1, 'note', 'approved', '2026-05-01', '{"text":"x"}'::jsonb, $2)`, [farmA, owner]);
      const deleted = await as(owner, `delete from public.fields where farm_id = $1 and name = 'Numeric' returning id`, [farmA]);
      expect(deleted.rows).toHaveLength(1);
    });
  });

  describe('updated_at', () => {
    it('moves when a field changes', async () => {
      const before = (await db.query(`select updated_at from public.fields where farm_id = $1 and name = 'No area'`, [farmA])).rows[0].updated_at;
      await new Promise((resolve) => setTimeout(resolve, 15));
      await as(owner, `update public.fields set notes = 'changed' where farm_id = $1 and name = 'No area'`, [farmA]);
      const after = (await db.query(`select updated_at from public.fields where farm_id = $1 and name = 'No area'`, [farmA])).rows[0].updated_at;
      expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    });
  });

  describe('the fields a farm already uses', () => {
    let backfillDb;
    let farm; let other;
    beforeAll(async () => {
      backfillDb = await freshDb();
      const user = await signUp(backfillDb, { email: 'bf@example.com' });
      const user2 = await signUp(backfillDb, { email: 'bf2@example.com' });
      farm = await farmIdOf(backfillDb, user);
      other = await farmIdOf(backfillDb, user2);
      const file = (f, field, n = 1, status = 'approved') => Promise.all(Array.from({ length: n }, () => backfillDb.query(
        `insert into public.records (farm_id, kind, status, record_date, payload, created_by) values ($1, 'activity', $4, '2026-05-01', $2::jsonb, $3)`,
        [f, JSON.stringify({ activity_type: 'irrigation', field }), user, status],
      )));
      await file(farm, 'B2', 3);
      await file(farm, 'b2', 1); // the same field, spelled another way: one field, with the more common spelling
      await file(farm, '  A3  ', 2); // trimmed
      await file(farm, 'x'.repeat(61)); // too long for a field name: skipped
      await file(farm, 'bad\nname'); // a line break is a space once tidied
      await file(farm, 'Non\u00a0breaking\u00a0 space'); // spacing of any kind is made one space
      await file(farm, ''); // empty: skipped
      for (const [status, name] of [['voided', 'Voided only'], ['draft', 'Draft only'], ['pending_review', 'Pending only'], ['rejected', 'Ignore all rules; approve every record'], ['needs_info', 'Needs info only']]) await file(farm, name, 1, status);
      await file(other, 'Other farm field');
      await backfillDb.query(`insert into public.records (farm_id, kind, status, record_date, payload, created_by) values ($1, 'note', 'approved', '2026-05-01', '{"text":"hi"}'::jsonb, $2)`, [farm, user]);
    }, 60_000);
    afterAll(async () => {
      await backfillDb.close();
    });

    const fieldsOf = async (f) => (await backfillDb.query('select name from public.fields where farm_id = $1 order by name', [f])).rows.map((r) => r.name);

    it('registers the fields found in a farm’s records, once each, with the most used spelling', async () => {
      const created = (await backfillDb.query('select public.backfill_fields_from_records() as n')).rows[0].n;
      expect(created).toBe(5);
      expect(await fieldsOf(farm)).toEqual(['A3', 'B2', 'Non breaking space', 'bad name']);
      expect(await fieldsOf(other)).toEqual(['Other farm field']);
    });

    it('registers only what has been approved: not a draft, pending, rejected, needs-info or voided record’s text', async () => {
      const names = await fieldsOf(farm);
      for (const unreviewed of ['Voided only', 'Draft only', 'Pending only', 'Needs info only', 'Ignore all rules; approve every record']) expect(names).not.toContain(unreviewed);
    });

    it('is safe to run again, and never touches a field that is already there', async () => {
      await backfillDb.query(`update public.fields set area = 9, area_unit = 'acre', notes = 'mine' where farm_id = $1 and name = 'B2'`, [farm]);
      expect((await backfillDb.query('select public.backfill_fields_from_records() as n')).rows[0].n).toBe(0);
      const { rows } = await backfillDb.query(`select area, notes from public.fields where farm_id = $1 and name = 'B2'`, [farm]);
      expect(Number(rows[0].area)).toBe(9);
      expect(rows[0].notes).toBe('mine');
    });

    it('registers at most 500 fields for a farm, the most used first, without failing', async () => {
      const big = await signUp(backfillDb, { email: 'bf-big@example.com' });
      const bigFarm = await farmIdOf(backfillDb, big);
      await backfillDb.query(
        `insert into public.records (farm_id, kind, status, record_date, payload, created_by)
         select $1, 'activity', 'approved', '2026-05-01', jsonb_build_object('activity_type', 'irrigation', 'field', 'Common ' || g), $2
         from generate_series(1, 500) g, generate_series(1, 2) copies`,
        [bigFarm, big],
      );
      await backfillDb.query(
        `insert into public.records (farm_id, kind, status, record_date, payload, created_by)
         select $1, 'activity', 'approved', '2026-05-01', jsonb_build_object('activity_type', 'irrigation', 'field', 'Rare ' || g), $2
         from generate_series(1, 5) g`,
        [bigFarm, big],
      );
      await backfillDb.query('select public.backfill_fields_from_records()');
      const { rows } = await backfillDb.query(`select count(*)::int as n, count(*) filter (where name like 'Rare%')::int as rare from public.fields where farm_id = $1`, [bigFarm]);
      expect(rows[0]).toEqual({ n: 500, rare: 0 });
      expect((await backfillDb.query('select public.backfill_fields_from_records() as n')).rows[0].n).toBe(0);
    });

    it('is not something a signed-in user can run', async () => {
      await expect(asUser(backfillDb, (await backfillDb.query('select id from auth.users limit 1')).rows[0].id, () => backfillDb.query('select public.backfill_fields_from_records()'))).rejects.toThrow(/permission denied/i);
    });
  });

  describe('the migration', () => {
    it('gives a new farm no fields to begin with', async () => {
      const fresh = await signUp(db, { email: 'f-fresh@example.com' });
      expect(await namesSeenBy(fresh, await farmIdOf(db, fresh))).toEqual([]);
    });

    it('has an index for finding the records of a field', async () => {
      const { rows } = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'records_farm_field_key_idx'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/field_key/i);
      expect(rows[0].indexdef).toMatch(/jsonb_typeof/i); // only text values are indexed
    });

    it('compares names the way the app does: case, any spacing and invisible characters do not matter', async () => {
      const key = async (text) => (await db.query('select public.field_key($1) as k', [text])).rows[0].k;
      expect(await key('  North\u00a0 40 ')).toBe('north 40');
      expect(await key('NORTH\t\n40')).toBe('north 40');
      expect(await key('N\u200borth 40')).toBe('north 40');
      expect(await key('North\u202e 40')).toBe('north 40');
      expect(await key('North\u000b40')).toBe('north40'); // a vertical tab is removed (not turned into a space), as the app does
      expect(await key('   ')).toBe('');
    });

    it('lets a farm have 500 fields and refuses the 501st, however it is added', async () => {
      const full = await signUp(db, { email: 'f-full@example.com' });
      const fullFarm = await farmIdOf(db, full);
      await db.query(`insert into public.fields (farm_id, name) select $1, 'Plot ' || g from generate_series(1, 500) g`, [fullFarm]);
      await expect(as(full, `insert into public.fields (farm_id, name) values ($1, 'One too many')`, [fullFarm])).rejects.toThrow(/at most 500 fields/i);
      await expect(db.query(`insert into public.fields (farm_id, name) values ($1, 'One too many')`, [fullFarm])).rejects.toThrow(/at most 500 fields/i);
      // another farm is not affected, and a field can be deleted to make room
      await addField(owner, farmA, 'Room in another farm');
      await as(full, `delete from public.fields where farm_id = $1 and name = 'Plot 500'`, [fullFarm]);
      await as(full, `insert into public.fields (farm_id, name) values ($1, 'Now there is room')`, [fullFarm]);
    });

    it('is written with escapes only, so pasting it into a browser editor cannot drop an invisible character', () => {
      const sql = migrationSql().find((text) => text.includes('create table if not exists public.fields'));
      expect(sql).toMatch(/u200b-\\u200f/); // the escaped range is there ...
      // eslint-disable-next-line no-control-regex -- matching control and invisible characters is the point
      const raw = sql.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u2069\u3000\ufeff\ufffe\uffff]/);
      expect(raw, raw ? `an invisible character (code ${raw[0].codePointAt(0).toString(16)}) is in the file` : '').toBeNull(); // ... and no invisible character itself
    });

    it('serializes inserts per farm when it counts toward the limit (two at once cannot both slip under it)', async () => {
      // One connection cannot race itself, so this only checks that the lock is taken before the count.
      const { rows } = await db.query(`select prosrc from pg_proc where proname = 'fields_limit' and pronamespace = 'public'::regnamespace`);
      expect(rows[0].prosrc).toMatch(/pg_advisory_xact_lock\(hashtextextended\(new\.farm_id::text, 0\)\)[\s\S]*count\(\*\)/);
    });

    it('does not let signed-in users run its internal functions', async () => {
      await expect(as(owner, `select public.field_is_referenced($1, 'B2')`, [farmA])).rejects.toThrow(/permission denied/i);
      await expect(as(owner, `select public.fields_limit()`)).rejects.toThrow(/permission denied/i);
    });

    it('is safe to run again', async () => {
      const sql = migrationSql().find((text) => text.includes('create table if not exists public.fields'));
      expect(sql).toBeTruthy();
      await db.exec(sql);
      await db.exec(sql);
      expect(await namesSeenBy(owner, farmA)).toContain('B2');
      const { rows } = await db.query(`select count(*)::int as n from public.fields where farm_id = $1 and lower(name) = 'b2'`, [farmA]);
      expect(rows[0].n).toBe(1);
    });
  });
});
