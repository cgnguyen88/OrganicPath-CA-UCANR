import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrationSql, LEGACY_USERS, freshDb, signUp, asUser, asAnon, farmIdOf } from './harness.js';

describe('Phase 0 migrations', () => {
  let db;
  beforeAll(async () => {
    db = await freshDb();
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  describe('farm provisioning on sign-up', () => {
    it('creates a farm and an owner membership from the farm_name given at registration', async () => {
      const id = await signUp(db, { email: 'p1@example.com', meta: { name: 'Pat', farm_name: 'Sunny Acres' } });
      const { rows } = await db.query(
        `select f.name, f.farm_code, m.role, f.created_by from public.farms f
           join public.farm_members m on m.farm_id = f.id where m.user_id = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Sunny Acres', role: 'owner', created_by: id });
      expect(rows[0].farm_code).toMatch(/^F-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    });

    it("falls back to the person's name, then to the email, when no farm name is given", async () => {
      const named = await signUp(db, { email: 'p2@example.com', meta: { name: 'Ana' } });
      const emailOnly = await signUp(db, { email: 'carlos@example.com' });
      const nameOf = async (uid) =>
        (await db.query('select f.name from public.farms f join public.farm_members m on m.farm_id=f.id where m.user_id=$1', [uid])).rows[0].name;
      expect(await nameOf(named)).toBe("Ana's Farm");
      expect(await nameOf(emailOnly)).toBe("carlos's Farm");
    });

    it('trims, truncates (120 chars) and rejects blank farm names safely', async () => {
      const long = await signUp(db, { email: 'p3@example.com', meta: { farm_name: `  ${'x'.repeat(500)}  ` } });
      const blank = await signUp(db, { email: 'blank@example.com', meta: { name: 'Bea', farm_name: '    ' } });
      const nameOf = async (uid) =>
        (await db.query('select f.name from public.farms f join public.farm_members m on m.farm_id=f.id where m.user_id=$1', [uid])).rows[0].name;
      expect((await nameOf(long)).length).toBe(120);
      expect(await nameOf(blank)).toBe("Bea's Farm");
    });

    it('generates unique farm codes', async () => {
      for (let i = 0; i < 60; i += 1) await signUp(db, { email: `bulk${i}@example.com` });
      const { rows } = await db.query('select count(*)::int as total, count(distinct farm_code)::int as uniq from public.farms');
      expect(rows[0].uniq).toBe(rows[0].total);
    });

    it('backfills a farm for every pre-existing user, including ones with no profile', async () => {
      for (const id of Object.values(LEGACY_USERS)) {
        expect(await farmIdOf(db, id)).toBeTruthy();
      }
    });
  });

  describe('self-healing and failure isolation', () => {
    it('provisions a farm when the account is created by a non-superuser role, like Supabase Auth does', async () => {
      await db.exec(`
        do $$ begin
          if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
        end $$;
        grant usage on schema auth, public to supabase_auth_admin;
        grant insert on auth.users to supabase_auth_admin;
      `);
      const id = crypto.randomUUID();
      await db.exec(`set role supabase_auth_admin;`);
      try {
        await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'authadmin@example.com', '{"farm_name":"Created By Auth"}')`, [id]);
      } finally {
        await db.exec('reset role;');
      }
      const { rows } = await db.query(`select f.name from public.farms f join public.farm_members m on m.farm_id = f.id where m.user_id = $1 and m.role = 'owner'`, [id]);
      expect(rows).toEqual([{ name: 'Created By Auth' }]);
    });

    it('ensure_my_farm() is idempotent and requires authentication', async () => {
      const id = await signUp(db, { email: 'idem@example.com', meta: { farm_name: 'Idem Farm' } });
      const first = await farmIdOf(db, id);
      const again = await asUser(db, id, async () => (await db.query('select public.ensure_my_farm() as f')).rows[0].f);
      expect(again).toBe(first);
      expect((await db.query('select count(*)::int as n from public.farm_members where user_id=$1', [id])).rows[0].n).toBe(1);

      await expect(asAnon(db, () => db.query('select public.ensure_my_farm()'))).rejects.toThrow();
    });

    it('never blocks sign-up if provisioning fails, and ensure_my_farm() repairs it later', async () => {
      const isolated = await freshDb({ seed: false });
      try {
        await isolated.exec('alter table public.farm_members add constraint test_block check (false) not valid;');
        const id = await signUp(isolated, { email: 'late@example.com', meta: { farm_name: 'Late Farm' } });
        expect((await isolated.query('select 1 from auth.users where id=$1', [id])).rows).toHaveLength(1);
        expect(await farmIdOf(isolated, id)).toBeUndefined();
        await expect(
          asUser(isolated, id, () => isolated.query(`insert into public.receipts (user_id, supplier, product) values ($1,'S','P')`, [id])),
        ).rejects.toThrow(/row-level security/i);

        await isolated.exec('alter table public.farm_members drop constraint test_block;');
        const healed = await asUser(isolated, id, async () => (await isolated.query('select public.ensure_my_farm() as f')).rows[0].f);
        expect(healed).toBeTruthy();
        expect(await farmIdOf(isolated, id)).toBe(healed);
      } finally {
        await isolated.close();
      }
    });

    it('does not let clients call the internal provisioning function directly', async () => {
      const id = await signUp(db, { email: 'direct@example.com' });
      await expect(
        asUser(db, id, () => db.query(`select public.ensure_farm_for_user('${id}', 'Hijack', 'x')`)),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('farm and membership isolation (RLS)', () => {
    it('lets each user see only their own farm', async () => {
      const a = await signUp(db, { email: 'iso-a@example.com', meta: { farm_name: 'A Farm' } });
      const b = await signUp(db, { email: 'iso-b@example.com', meta: { farm_name: 'B Farm' } });
      const seenByA = await asUser(db, a, async () => (await db.query('select name from public.farms')).rows.map((r) => r.name));
      expect(seenByA).toEqual(['A Farm']);
      const seenByB = await asUser(db, b, async () => (await db.query('select name from public.farms')).rows.map((r) => r.name));
      expect(seenByB).toEqual(['B Farm']);
    });

    it("blocks a user from editing another farm, and clients can't create or delete farms", async () => {
      const a = await signUp(db, { email: 'edit-a@example.com', meta: { farm_name: 'Edit A' } });
      const b = await signUp(db, { email: 'edit-b@example.com', meta: { farm_name: 'Edit B' } });
      const farmB = await farmIdOf(db, b);

      const updated = await asUser(db, a, () => db.query(`update public.farms set name = 'Pwned' where id = $1 returning id`, [farmB]));
      expect(updated.rows).toHaveLength(0);

      await expect(asUser(db, a, () => db.query(`insert into public.farms (name) values ('Rogue')`))).rejects.toThrow(/permission denied|row-level security/i);

      const farmA = await farmIdOf(db, a);
      await expect(asUser(db, a, () => db.query('delete from public.farms where id = $1', [farmA]))).rejects.toThrow(/permission denied/i);
    });

    it('limits farm edits to owners and managers, not crew', async () => {
      const owner = await signUp(db, { email: 'own@example.com', meta: { farm_name: 'Role Farm' } });
      const manager = await signUp(db, { email: 'mgr@example.com' });
      const crew = await signUp(db, { email: 'crew@example.com' });
      const farm = await farmIdOf(db, owner);
      await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1,$2,'manager'), ($1,$3,'crew')`, [farm, manager, crew]);

      const rename = (uid, name) => asUser(db, uid, () => db.query('update public.farms set name=$2 where id=$1 returning id', [farm, name]));
      expect((await rename(crew, 'By Crew')).rows).toHaveLength(0);
      expect((await rename(manager, 'By Manager')).rows).toHaveLength(1);
      expect((await rename(owner, 'By Owner')).rows).toHaveLength(1);
    });

    it('does not let clients write memberships at all: owners cannot add, move or remove anyone', async () => {
      const owner = await signUp(db, { email: 'm-own@example.com', meta: { farm_name: 'Team Farm' } });
      const crew = await signUp(db, { email: 'm-crew@example.com' });
      const outsider = await signUp(db, { email: 'm-out@example.com' });
      const farm = await farmIdOf(db, owner);
      await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1,$2,'crew')`, [farm, crew]); // server-side add

      const denied = /permission denied|row-level security/i;
      const write = (uid, sql, params) => asUser(db, uid, () => db.query(sql, params));

      await expect(write(owner, `insert into public.farm_members (farm_id, user_id, role) values ($1,$2,'crew')`, [farm, outsider])).rejects.toThrow(denied);
      await expect(write(owner, `update public.farm_members set role='manager' where farm_id=$1 and user_id=$2`, [farm, crew])).rejects.toThrow(denied);
      await expect(write(owner, `delete from public.farm_members where farm_id=$1 and user_id=$2`, [farm, crew])).rejects.toThrow(denied);
      await expect(write(outsider, `insert into public.farm_members (farm_id, user_id, role) values ($1,$2,'owner')`, [farm, outsider])).rejects.toThrow(denied);
      await expect(write(crew, `update public.farm_members set role='owner' where farm_id=$1 and user_id=$2`, [farm, crew])).rejects.toThrow(denied);

      // members can still SEE their teammates and farm
      expect(await asUser(db, crew, async () => (await db.query('select user_id from public.farm_members where farm_id=$1', [farm])).rows)).toHaveLength(2);
    });

    it("cannot be used to pull a stranger's receipts into an attacker's farm (backdated membership attack)", async () => {
      const attacker = await signUp(db, { email: 'atk@example.com', meta: { farm_name: 'Attacker Farm' } });
      const victim = await signUp(db, { email: 'vic@example.com', meta: { farm_name: 'Victim Farm' } });
      const attackerFarm = await farmIdOf(db, attacker);
      const victimFarm = await farmIdOf(db, victim);

      await expect(
        asUser(db, attacker, () =>
          db.query(`insert into public.farm_members (farm_id, user_id, role, created_at) values ($1,$2,'crew','1970-01-01')`, [attackerFarm, victim]),
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);

      const row = await asUser(db, victim, async () =>
        (await db.query(`insert into public.receipts (user_id, supplier, product) values ($1,'S','Victim buy') returning farm_id`, [victim])).rows[0],
      );
      expect(row.farm_id).toBe(victimFarm);
      expect(await asUser(db, attacker, async () => (await db.query(`select 1 from public.receipts where product='Victim buy'`)).rows)).toHaveLength(0);
    });

    it('protects farm identity columns: managers can rename a farm but not change id, farm_code or created_by', async () => {
      const owner = await signUp(db, { email: 'col-own@example.com', meta: { farm_name: 'Col Farm' } });
      const manager = await signUp(db, { email: 'col-mgr@example.com' });
      const farm = await farmIdOf(db, owner);
      await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1,$2,'manager')`, [farm, manager]);

      const update = (set, params = []) => asUser(db, manager, () => db.query(`update public.farms set ${set} where id = '${farm}' returning id`, params));
      expect((await update(`name = 'Renamed'`)).rows).toHaveLength(1);
      expect((await update(`season_start_month = 4, season_start_day = 1`)).rows).toHaveLength(1);
      await expect(update(`farm_code = 'F-HIJACK'`)).rejects.toThrow(/permission denied/i);
      await expect(update(`created_by = '${manager}'`)).rejects.toThrow(/permission denied/i);
      await expect(update(`id = gen_random_uuid()`)).rejects.toThrow(/permission denied/i);
    });

    it('rejects an invalid role value', async () => {
      const owner = await signUp(db, { email: 'badrole@example.com' });
      const other = await signUp(db, { email: 'badrole2@example.com' });
      await expect(
        db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1,$2,'superuser')`, [await farmIdOf(db, owner), other]),
      ).rejects.toThrow(/check constraint/i);
    });

    it('denies anonymous callers all access to tenant tables', async () => {
      for (const table of ['farms', 'farm_members', 'profiles', 'receipts']) {
        await expect(asAnon(db, () => db.query(`select * from public.${table}`)), table).rejects.toThrow(/permission denied/i);
      }
    });

    it('removes TRUNCATE and other RLS-bypassing privileges from signed-in clients', async () => {
      for (const table of ['farms', 'farm_members', 'profiles', 'receipts']) {
        for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const { rows } = await db.query(`select has_table_privilege('authenticated', 'public.${table}', '${privilege}') as allowed`);
          expect(rows[0].allowed, `${table} ${privilege}`).toBe(false);
        }
      }
    });

    it('keeps internal functions away from clients and exposes only the intended entry points', async () => {
      const canExecute = async (role, fn) =>
        (await db.query(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).rows[0].ok;

      for (const fn of ['public.generate_farm_code()', 'public.farms_touch_updated_at()', 'public.provision_farm_for_new_user()', 'public.receipts_default_farm()', 'public.ensure_farm_for_user(uuid,text,text)']) {
        expect(await canExecute('anon', fn), `anon ${fn}`).toBe(false);
        expect(await canExecute('authenticated', fn), `authenticated ${fn}`).toBe(false);
      }
      expect(await canExecute('authenticated', 'public.ensure_my_farm()')).toBe(true);
      expect(await canExecute('anon', 'public.ensure_my_farm()')).toBe(false);
      for (const fn of ['public.my_farm_ids()', 'public.is_farm_member(uuid)']) {
        expect(await canExecute('authenticated', fn), fn).toBe(true);
        expect(await canExecute('anon', fn), fn).toBe(false);
      }
    });
  });

  describe('profiles (RLS)', () => {
    it('lets a user read and write only their own profile row', async () => {
      const a = await signUp(db, { email: 'pr-a@example.com' });
      const b = await signUp(db, { email: 'pr-b@example.com' });
      await db.query(`insert into public.profiles (id, operation_data) values ($1,'{"x":1}'), ($2,'{"x":2}')`, [a, b]);

      const seen = await asUser(db, a, async () => (await db.query('select id from public.profiles')).rows.map((r) => r.id));
      expect(seen).toEqual([a]);

      const stolen = await asUser(db, a, () => db.query(`update public.profiles set operation_data='{"hacked":true}' where id=$1 returning id`, [b]));
      expect(stolen.rows).toHaveLength(0);

      await expect(
        asUser(db, a, () => db.query(`insert into public.profiles (id, operation_data) values ($1,'{}')`, [crypto.randomUUID()])),
      ).rejects.toThrow();

      const own = await asUser(db, a, () => db.query(`update public.profiles set operation_data='{"x":9}' where id=$1 returning id`, [a]));
      expect(own.rows).toHaveLength(1);
    });
  });

  describe('receipts (RLS)', () => {
    it('backfills legacy receipts with their owner’s farm', async () => {
      const { rows } = await db.query('select user_id, farm_id from public.receipts where supplier in ($1,$2)', ['Acme', 'Bobco']);
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.farm_id).toBe(await farmIdOf(db, r.user_id));
    });

    it('neutralizes the legacy wide-open policy: users no longer see other farms’ receipts', async () => {
      const seen = await asUser(db, LEGACY_USERS.alice, async () => (await db.query('select supplier from public.receipts')).rows.map((r) => r.supplier));
      expect(seen).toContain('Acme');
      expect(seen).not.toContain('Bobco');
    });

    it('assigns the caller’s farm automatically on insert (so the current client keeps working)', async () => {
      const a = await signUp(db, { email: 'rc-a@example.com' });
      const row = await asUser(db, a, async () =>
        (await db.query(`insert into public.receipts (user_id, supplier, product) values ($1,'S','P') returning farm_id`, [a])).rows[0],
      );
      expect(row.farm_id).toBe(await farmIdOf(db, a));
    });

    it('rejects inserting into another farm or impersonating another user', async () => {
      const a = await signUp(db, { email: 'rc2-a@example.com' });
      const b = await signUp(db, { email: 'rc2-b@example.com' });
      const farmB = await farmIdOf(db, b);

      await expect(
        asUser(db, a, () => db.query(`insert into public.receipts (user_id, farm_id, supplier, product) values ($1,$2,'S','P')`, [a, farmB])),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asUser(db, a, () => db.query(`insert into public.receipts (user_id, supplier, product) values ($1,'S','P')`, [b])),
      ).rejects.toThrow(/row-level security/i);
    });

    it('has no update path: nobody can rewrite a saved receipt (compliance record), including owners', async () => {
      const owner = await signUp(db, { email: 'rc4-own@example.com' });
      const row = await asUser(db, owner, async () =>
        (await db.query(`insert into public.receipts (user_id, supplier, product, total_cost) values ($1,'S','P', 10) returning id`, [owner])).rows[0],
      );
      await expect(
        asUser(db, owner, () => db.query(`update public.receipts set total_cost = 0 where id = $1`, [row.id])),
      ).rejects.toThrow(/permission denied|row-level security/i);
      expect((await db.query('select total_cost from public.receipts where id=$1', [row.id])).rows[0].total_cost).toBe('10');
    });

    it('lets crew log receipts for their farm but only owners and managers delete them', async () => {
      const owner = await signUp(db, { email: 'rc3-own@example.com' });
      const crew = await signUp(db, { email: 'rc3-crew@example.com' });
      const farm = await farmIdOf(db, owner);
      await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1,$2,'crew')`, [farm, crew]);

      const crewRow = await asUser(db, crew, async () =>
        (await db.query(`insert into public.receipts (user_id, farm_id, supplier, product) values ($1,$2,'S','Crew buy') returning id`, [crew, farm])).rows[0],
      );
      expect(await asUser(db, owner, async () => (await db.query('select id from public.receipts where id=$1', [crewRow.id])).rows)).toHaveLength(1);

      const crewDelete = await asUser(db, crew, () => db.query('delete from public.receipts where id=$1 returning id', [crewRow.id]));
      expect(crewDelete.rows).toHaveLength(0);
      const ownerDelete = await asUser(db, owner, () => db.query('delete from public.receipts where id=$1 returning id', [crewRow.id]));
      expect(ownerDelete.rows).toHaveLength(1);
    });
  });

  describe('private receipts storage', () => {
    it('flips a public receipts bucket to private', async () => {
      const { rows } = await db.query(`select public from storage.buckets where id='receipts'`);
      expect(rows[0].public).toBe(false);
    });

    it('caps file size and file types on the bucket', async () => {
      const { rows } = await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id='receipts'`);
      expect(Number(rows[0].file_size_limit)).toBe(10 * 1024 * 1024);
      expect(rows[0].allowed_mime_types).toEqual(expect.arrayContaining(['image/jpeg', 'application/pdf']));
      expect(rows[0].allowed_mime_types).not.toContain('text/html');
      expect(rows[0].allowed_mime_types).not.toContain('image/svg+xml');
    });

    it('removes the old receipts policies but leaves policies for other buckets (e.g. receipts-archive) alone', async () => {
      const { rows } = await db.query(`select policyname from pg_policies where schemaname='storage' and tablename='objects' order by 1`);
      const names = rows.map((r) => r.policyname);
      expect(names).toContain('archive_read');
      expect(names).toEqual(expect.arrayContaining(['receipts_objects_select_own', 'receipts_objects_insert_own', 'receipts_objects_delete_own']));
    });

    it.each([
      ['a wide-open SELECT policy', `create policy legacy_open_read on storage.objects for select using (true);`],
      ['a role-only SELECT policy with no bucket condition', `create policy legacy_authed_read on storage.objects for select to authenticated using (current_user = 'authenticated');`],
      ['a wide-open INSERT policy', `create policy legacy_open_write on storage.objects for insert with check (true);`],
      ['a wide-open ALL policy', `create policy legacy_all on storage.objects for all using (true) with check (true);`],
      ['a bucket_id = ANY(array) policy that does not name receipts', `create policy legacy_any on storage.objects for select to authenticated using (bucket_id = any (array['avatars'::text, 'docs'::text]));`],
      ['a negated bucket policy (bucket_id <> ...)', `create policy legacy_neg on storage.objects for select to authenticated using (bucket_id <> 'zzz');`],
      ['a bucket pin that is OR-ed with true', `create policy legacy_or on storage.objects for select to authenticated using (bucket_id = 'avatars' or true);`],
      ['a NOT-wrapped bucket pin', `create policy legacy_not on storage.objects for select to authenticated using (not (bucket_id = 'avatars'));`],
      ['a bucket_id mention that is not a restriction', `create policy legacy_mention on storage.objects for select to authenticated using (bucket_id is not null);`],
    ])('fails loudly instead of leaving the bucket exposed by %s', async (_label, legacySql) => {
      await expect(freshDb({ seed: false, legacySql })).rejects.toThrow(/Cannot apply: storage\.objects has permissive/i);
    });

    it.each([
      ['= ANY(array[…])', `bucket_id = any (array['receipts'::text, 'avatars'::text])`],
      ['IN (…)', `bucket_id in ('receipts', 'avatars')`],
      ['a plain equality', `bucket_id = 'receipts'`],
    ])('drops a legacy policy that names the receipts bucket via %s (it would otherwise be OR-ed in)', async (_label, predicate) => {
      const isolated = await freshDb({
        seed: false,
        legacySql: `create policy legacy_names_receipts on storage.objects for select to authenticated using (${predicate});`,
      });
      try {
        expect((await isolated.query(`select 1 from pg_policies where policyname = 'legacy_names_receipts'`)).rows).toHaveLength(0);
      } finally {
        await isolated.close();
      }
    });

    it('keeps a policy pinned to one other bucket, including one that also checks the path', async () => {
      const isolated = await freshDb({
        seed: false,
        legacySql: `create policy avatars_read on storage.objects for select to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = 'public');`,
      });
      try {
        expect((await isolated.query(`select 1 from pg_policies where policyname = 'avatars_read'`)).rows).toHaveLength(1);
      } finally {
        await isolated.close();
      }
    });

    it('also drops a legacy policy scoped to the receipts bucket itself (it would otherwise be OR-ed in)', async () => {
      const isolated = await freshDb({
        seed: false,
        legacySql: `create policy legacy_receipts_read on storage.objects for select to authenticated using (bucket_id = 'receipts');`,
      });
      try {
        const { rows } = await isolated.query(`select 1 from pg_policies where policyname = 'legacy_receipts_read'`);
        expect(rows).toHaveLength(0);
      } finally {
        await isolated.close();
      }
    });

    it('restricts objects to the owner’s own folder', async () => {
      const a = await signUp(db, { email: 'st-a@example.com' });
      const b = await signUp(db, { email: 'st-b@example.com' });

      await asUser(db, a, () => db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${a}/one.png`, a]));
      await expect(
        asUser(db, a, () => db.query(`insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${b}/two.png`, a])),
      ).rejects.toThrow(/row-level security/i);

      const seenByA = await asUser(db, a, async () => (await db.query('select name from storage.objects')).rows.map((r) => r.name));
      expect(seenByA).toEqual([`${a}/one.png`]);
      const seenByB = await asUser(db, b, async () => (await db.query('select name from storage.objects')).rows);
      expect(seenByB).toHaveLength(0);
      expect(await asAnon(db, async () => (await db.query('select name from storage.objects')).rows)).toHaveLength(0);
    });
  });

  describe('on a brand-new Supabase project (no legacy tables, no default grants)', () => {
    let fresh;
    beforeAll(async () => {
      fresh = await freshDb({ legacy: false, defaultGrants: false });
    }, 60_000);
    afterAll(async () => {
      await fresh.close();
    });

    const PROFILE_COLUMNS = ['operation_data', 'compliance_state', 'wizard_progress', 'occsp_state', 'state_reg_type', 'state_reg_state'];

    it('creates the tables and every column the app reads and writes', async () => {
      const { rows } = await fresh.query(`select column_name from information_schema.columns where table_schema='public' and table_name='profiles'`);
      expect(rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(['id', 'updated_at', ...PROFILE_COLUMNS]));
      const receipts = await fresh.query(`select column_name from information_schema.columns where table_schema='public' and table_name='receipts'`);
      expect(receipts.rows.map((r) => r.column_name)).toEqual(
        expect.arrayContaining(['id', 'user_id', 'farm_id', 'file_path', 'file_name', 'file_url', 'supplier', 'product', 'omri_listed', 'total_cost', 'invoice_number', 'added_at']),
      );
    });

    it('lets a signed-in user save a profile with every column the app writes, then read it back', async () => {
      const id = await signUp(fresh, { email: 'new1@example.com', meta: { farm_name: 'Fresh Farm' } });
      const row = await asUser(fresh, id, async () => {
        await fresh.query(
          `insert into public.profiles (id, operation_data, compliance_state, wizard_progress, occsp_state, state_reg_type, state_reg_state)
           values ($1, '{"a":1}', '{"b":2}', '{"c":3}', '{"d":4}', 'cdfa', '{"e":5}')`,
          [id],
        );
        await fresh.query(`update public.profiles set operation_data = '{"a":2}', updated_at = now() where id = $1`, [id]);
        return (await fresh.query('select * from public.profiles where id = $1', [id])).rows[0];
      });
      expect(row.operation_data).toEqual({ a: 2 });
      expect(row.state_reg_type).toBe('cdfa');
    });

    it('lets a signed-in user add, list and delete their receipts', async () => {
      const id = await signUp(fresh, { email: 'new2@example.com' });
      await asUser(fresh, id, async () => {
        const added = (await fresh.query(`insert into public.receipts (user_id, supplier, product, total_cost) values ($1,'Acme','Compost', 12.5) returning id, farm_id`, [id])).rows[0];
        expect(added.farm_id).toBe(await farmIdOf(fresh, id));
        expect((await fresh.query('select id from public.receipts')).rows).toHaveLength(1);
        expect((await fresh.query('delete from public.receipts where id = $1 returning id', [added.id])).rows).toHaveLength(1);
      });
    });

    it('still denies anonymous callers and cross-user reads', async () => {
      const a = await signUp(fresh, { email: 'new3@example.com' });
      const b = await signUp(fresh, { email: 'new4@example.com' });
      await asUser(fresh, a, () => fresh.query(`insert into public.receipts (user_id, supplier, product) values ($1,'A','Only A')`, [a]));
      expect(await asUser(fresh, b, async () => (await fresh.query(`select 1 from public.receipts where product = 'Only A'`)).rows)).toHaveLength(0);
      await expect(asAnon(fresh, () => fresh.query('select * from public.receipts'))).rejects.toThrow(/permission denied/i);
    });
  });

  it('adds the missing profile columns to an existing, older profiles table without losing data', async () => {
    const { rows } = await db.query(`select operation_data, compliance_state from public.profiles where id = '${LEGACY_USERS.alice}'`);
    expect(rows[0].operation_data).toEqual({ farm: 'alice' });
    expect(rows[0].compliance_state).toBeNull();
  });

  it('refuses to apply when legacy receipts have no owner, instead of silently hiding them from everyone', async () => {
    await expect(
      freshDb({ seed: false, legacySql: `insert into public.receipts (user_id, supplier, product) values (null, 'Ghost', 'Orphan');` }),
    ).rejects.toThrow(/have no farm/i);
  });

  it('is idempotent: re-running every migration changes no data and leaves the exact same policies', async () => {
    const snapshot = async () => ({
      farms: (await db.query('select count(*)::int as n from public.farms')).rows[0].n,
      policies: (await db.query(`select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname in ('public','storage') order by 1,2,3`)).rows,
    });
    const before = await snapshot();
    for (const sql of migrationSql()) await db.exec(sql);
    expect(await snapshot()).toEqual(before);
  });
});
