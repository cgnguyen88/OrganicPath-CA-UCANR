import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, signUp, asUser, asAnon, asServiceRole, farmIdOf } from './harness.js';

const sha256 = async (text) => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
};

describe('Phase 3 migration: chat channels (Telegram)', () => {
  let db; let owner; let crew; let outsider; let farm; let outsiderFarm;
  beforeAll(async () => {
    db = await freshDb();
    owner = await signUp(db, { email: 'ch-owner@example.com' });
    crew = await signUp(db, { email: 'ch-crew@example.com' });
    outsider = await signUp(db, { email: 'ch-out@example.com' });
    farm = await farmIdOf(db, owner);
    outsiderFarm = await farmIdOf(db, outsider);
    await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1, $2, 'crew')`, [farm, crew]);
    await db.query('delete from public.farm_members where user_id = $1 and farm_id <> $2', [crew, farm]);
  }, 60_000);
  beforeEach(async () => {
    await db.query('delete from public.channel_link_codes'); // each test starts with a clean hourly allowance
  });
  afterAll(async () => {
    await db.close();
  });

  const makeCode = (uid, lang = 'en') => asUser(db, uid, async () => (await db.query('select * from public.create_channel_link_code($1)', [lang])).rows[0]);
  const consume = (code, externalId, provider = 'telegram', displayName = 'Maria (@maria)') =>
    asServiceRole(db, async () => (await db.query('select * from public.consume_channel_link_code($1, $2, $3, $4)', [provider, code === null ? null : await sha256(code), externalId, displayName])).rows);
  const confirm = (externalId, provider = 'telegram') =>
    asServiceRole(db, async () => (await db.query('select public.confirm_channel_identity($1, $2) as ok', [provider, externalId])).rows[0].ok);
  const link = async (uid, externalId, lang = 'en') => { const { code } = await makeCode(uid, lang); await consume(code, externalId); return confirm(externalId); };
  const identityFor = async (externalId) => (await db.query(`select * from public.channel_identities where provider = 'telegram' and external_id = $1`, [externalId])).rows[0];

  describe('one-time link codes', () => {
    it('gives a signed-in farm member a long random code that expires soon, and stores only its hash', async () => {
      const result = await makeCode(owner, 'es');
      expect(result.code).toMatch(/^[0-9a-f]{32}$/);
      const minutes = (new Date(result.expires_at) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(10);
      expect(minutes).toBeLessThanOrEqual(15.5);
      const stored = (await db.query('select code_hash, user_id, farm_id, lang from public.channel_link_codes where code_hash = $1', [await sha256(result.code)])).rows[0];
      expect(stored).toMatchObject({ user_id: owner, farm_id: farm, lang: 'es' });
      const hint = (await db.query('select farm_name, owner_hint from public.channel_link_codes where code_hash = $1', [await sha256(result.code)])).rows[0];
      expect(hint.farm_name).toBeTruthy();
      expect(hint.owner_hint).toBe('c***@example.com');
      const anyPlaintext = await db.query('select 1 from public.channel_link_codes where code_hash = $1', [result.code]);
      expect(anyPlaintext.rows).toHaveLength(0);
    });

    it('gives a different code every time', async () => {
      const a = await makeCode(crew); const b = await makeCode(crew);
      expect(a.code).not.toBe(b.code);
    });

    it('refuses a user who belongs to no farm, anonymous callers, and an unknown language', async () => {
      await db.query('delete from public.farm_members where user_id = $1', [outsider]);
      await expect(makeCode(outsider)).rejects.toThrow(/farm/i);
      await expect(asAnon(db, () => db.query(`select * from public.create_channel_link_code('en')`))).rejects.toThrow(/permission denied/i);
      await expect(makeCode(owner, 'fr')).rejects.toThrow(/language/i);
    });

    it('limits how many codes one user can make in an hour', async () => {
      const user = await signUp(db, { email: 'ch-spam@example.com' });
      for (let i = 0; i < 5; i += 1) await makeCode(user);
      await expect(makeCode(user)).rejects.toThrow(/too many/i);
    });

    it('is not readable or writable by clients', async () => {
      await expect(asUser(db, owner, () => db.query('select * from public.channel_link_codes'))).rejects.toThrow(/permission denied/i);
      await expect(asUser(db, owner, () => db.query(`insert into public.channel_link_codes (code_hash, user_id, farm_id, expires_at) values ('x', $1, $2, now())`, [owner, farm]))).rejects.toThrow(/permission denied/i);
    });
  });

  describe('linking a Telegram account (two steps: redeem the code, then confirm in Telegram)', () => {
    it('redeems a code into a PENDING link and tells the Telegram user which farm and owner it is for', async () => {
      const { code } = await makeCode(crew, 'es');
      const rows = await consume(code, 'tg-1001');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ r_user_id: crew, r_farm_id: farm, r_lang: 'es' });
      expect(rows[0].r_farm_name).toBeTruthy();
      expect(rows[0].r_owner_hint).toBe('c***@example.com'); // masked, never the full address
      expect(await identityFor('tg-1001')).toMatchObject({ user_id: crew, farm_id: farm, lang: 'es', provider: 'telegram', confirmed_at: null, display_name: 'Maria (@maria)' });
      expect(await consume(code, 'tg-2002')).toEqual([]); // single use
      expect(await identityFor('tg-2002')).toBeUndefined();
    });

    it('becomes active only when the Telegram user confirms', async () => {
      const { code } = await makeCode(owner);
      await consume(code, 'tg-1002');
      expect(await confirm('tg-1002')).toBe(true);
      expect((await identityFor('tg-1002')).confirmed_at).not.toBeNull();
      expect(await confirm('tg-1002')).toBe(false); // nothing left to confirm
      expect(await confirm('tg-nobody')).toBe(false);
    });

    it('cannot be confirmed after the 15 minutes are up', async () => {
      const { code } = await makeCode(owner);
      await consume(code, 'tg-1003');
      await db.query(`update public.channel_identities set linked_at = now() - interval '16 minutes' where external_id = 'tg-1003'`);
      expect(await confirm('tg-1003')).toBe(false);
    });

    it('cannot be confirmed if the person who made the code has since left the farm', async () => {
      const leaver = await signUp(db, { email: 'ch-leaver2@example.com' });
      const leaverFarm = await farmIdOf(db, leaver);
      const { code } = await makeCode(leaver);
      await consume(code, 'tg-1004');
      await db.query('delete from public.farm_members where user_id = $1 and farm_id = $2', [leaver, leaverFarm]);
      expect(await confirm('tg-1004')).toBe(false);
    });

    it.each([['an unknown code', 'f'.repeat(32)], ['no code', null]])('ignores %s', async (_n, code) => {
      expect(await consume(code, 'tg-3003')).toEqual([]);
      expect(await identityFor('tg-3003')).toBeUndefined();
    });

    it('ignores an expired code', async () => {
      const { code } = await makeCode(owner);
      await db.query(`update public.channel_link_codes set expires_at = now() - interval '1 second' where code_hash = $1`, [await sha256(code)]);
      expect(await consume(code, 'tg-4004')).toEqual([]);
    });

    it('ignores a code whose owner has since left the farm', async () => {
      const leaver = await signUp(db, { email: 'ch-leaver@example.com' });
      const leaverFarm = await farmIdOf(db, leaver);
      const { code } = await makeCode(leaver);
      await db.query('delete from public.farm_members where user_id = $1 and farm_id = $2', [leaver, leaverFarm]);
      expect(await consume(code, 'tg-5005')).toEqual([]);
    });

    it('lets the latest code win while a link is still pending', async () => {
      const first = await makeCode(owner); await consume(first.code, 'tg-6006');
      const second = await makeCode(crew); await consume(second.code, 'tg-6006');
      expect((await identityFor('tg-6006')).user_id).toBe(crew);
      expect(Number((await db.query(`select count(*) from public.channel_identities where external_id = 'tg-6006'`)).rows[0].count)).toBe(1);
    });

    it('NEVER takes over a Telegram account that is already connected, and does not spend the code trying', async () => {
      await link(owner, 'tg-6007');
      const attacker = await makeCode(crew);
      expect(await consume(attacker.code, 'tg-6007')).toEqual([]);
      expect(await identityFor('tg-6007')).toMatchObject({ user_id: owner });
      const unused = await db.query('select used_at from public.channel_link_codes where code_hash = $1', [await sha256(attacker.code)]);
      expect(unused.rows[0].used_at).toBeNull();
      // After the owner disconnects (/stop), the code works.
      await db.query(`delete from public.channel_identities where external_id = 'tg-6007'`);
      expect(await consume(attacker.code, 'tg-6007')).toHaveLength(1);
    });

    it('rejects an unknown provider, and cannot be called by clients', async () => {
      const { code } = await makeCode(owner);
      await expect(consume(code, 'tg-7007', 'carrier-pigeon')).rejects.toThrow();
      await expect(asUser(db, owner, () => db.query(`select * from public.consume_channel_link_code('telegram', 'x', 'y', null)`))).rejects.toThrow(/permission denied/i);
      const { rows } = await db.query(`select
        has_function_privilege('authenticated', 'public.consume_channel_link_code(text,text,text,text)', 'execute') as authed,
        has_function_privilege('anon', 'public.consume_channel_link_code(text,text,text,text)', 'execute') as anon,
        has_function_privilege('service_role', 'public.consume_channel_link_code(text,text,text,text)', 'execute') as service,
        has_function_privilege('authenticated', 'public.confirm_channel_identity(text,text)', 'execute') as confirm_authed`);
      expect(rows[0]).toEqual({ authed: false, anon: false, service: true, confirm_authed: false });
    });

    it('shortens a very long display name instead of refusing the link', async () => {
      const { code } = await makeCode(owner);
      await consume(code, 'tg-8000', 'telegram', 'x'.repeat(200));
      expect((await identityFor('tg-8000')).display_name).toHaveLength(64);
    });
  });

  describe('linked accounts (channel_identities)', () => {
    it('shows a user their own links only, and lets them unlink', async () => {
      await link(owner, 'tg-8001');
      await link(crew, 'tg-8002');
      const ownerSees = await asUser(db, owner, async () => (await db.query('select external_id from public.channel_identities')).rows.map((r) => r.external_id));
      expect(ownerSees).toContain('tg-8001');
      expect(ownerSees).not.toContain('tg-8002');
      await asUser(db, owner, () => db.query(`delete from public.channel_identities where external_id = 'tg-8001'`));
      expect(await identityFor('tg-8001')).toBeUndefined();
    });

    it('does not let a user unlink someone else’s account or create or edit links', async () => {
      await link(crew, 'tg-8003');
      const removed = await asUser(db, owner, () => db.query(`delete from public.channel_identities where external_id = 'tg-8003' returning 1`));
      expect(removed.rows).toHaveLength(0);
      // A delete with no WHERE or RETURNING is checked by the delete policy alone.
      await asUser(db, owner, () => db.query('delete from public.channel_identities'));
      expect(await identityFor('tg-8003')).toMatchObject({ user_id: crew });
      await expect(asUser(db, owner, () => db.query(`insert into public.channel_identities (provider, external_id, user_id, farm_id) values ('telegram', 'tg-evil', $1, $2)`, [owner, farm]))).rejects.toThrow(/permission denied/i);
      await expect(asUser(db, owner, () => db.query(`update public.channel_identities set user_id = $1`, [owner]))).rejects.toThrow(/permission denied/i);
    });

    it('is closed to signed-out visitors', async () => {
      await expect(asAnon(db, () => db.query('select * from public.channel_identities'))).rejects.toThrow(/permission denied/i);
    });
  });

  describe('processed updates (retries must not repeat work)', () => {
    const claim = (id, provider = 'telegram') => asServiceRole(db, async () => (await db.query('select public.claim_channel_update($1, $2) as first', [provider, id])).rows[0].first);

    it('says yes the first time an update arrives and no after that', async () => {
      expect(await claim(900001)).toBe(true);
      expect(await claim(900001)).toBe(false);
      expect(await claim(900002)).toBe(true);
    });

    it('keeps providers apart', async () => {
      expect(await claim(900003, 'telegram')).toBe(true);
      expect(await claim(900003, 'whatsapp')).toBe(true);
    });

    it('tidies itself: each new update clears a few old ones, with no job to schedule', async () => {
      await db.query(`insert into public.channel_updates (provider, update_id, received_at) values ('telegram', 777001, now() - interval '30 days'), ('telegram', 777002, now() - interval '30 days')`);
      await db.query(`insert into public.channel_link_codes (code_hash, user_id, farm_id, expires_at) values ('stale-code-hash', $1, $2, now() - interval '3 days')`, [owner, farm]);
      await claim(900500);
      const left = (await db.query(`select count(*)::int as n from public.channel_updates where update_id in (777001, 777002)`)).rows[0].n;
      expect(left).toBe(0);
      expect((await db.query(`select count(*)::int as n from public.channel_link_codes where code_hash = 'stale-code-hash'`)).rows[0].n).toBe(0);
    });

    it('is for the server only, and old entries can be purged', async () => {
      await expect(asUser(db, owner, () => db.query(`select public.claim_channel_update('telegram', 1)`))).rejects.toThrow(/permission denied/i);
      await expect(asUser(db, owner, () => db.query('select * from public.channel_updates'))).rejects.toThrow(/permission denied/i);
      await db.query(`update public.channel_updates set received_at = now() - interval '10 days' where update_id = 900002`);
      const purged = await asServiceRole(db, async () => Number((await db.query('select public.purge_channel_data() as n')).rows[0].n));
      expect(purged).toBeGreaterThanOrEqual(1);
      expect(await claim(900002)).toBe(true); // forgotten, so it counts as new again
    });
  });

  describe('replies to a captured record (channel_update_record)', () => {
    const newRecord = async (over = {}) => (await db.query(
      `insert into public.records (farm_id, kind, status, payload, missing_fields, created_by, source, source_ref)
       values ($1, 'activity', $2, $3::jsonb, $4, $5, 'telegram', $6) returning id, version`,
      [farm, over.status ?? 'needs_info', JSON.stringify(over.payload ?? { activity_type: 'spray', field: 'B2' }), over.missing ?? ['product', 'rate', 'target'], over.by ?? crew, `tg-${Math.random()}`],
    )).rows[0];
    const patch = (over = {}) => JSON.stringify({ record_date: '2026-10-11', payload: { activity_type: 'spray', field: 'B2', product: 'Neem', rate: '2 oz/gal', target: 'aphids' }, status: 'pending_review', missing_fields: [], fingerprint: 'activity|2026-10-11|b2', ...over });
    const update = (actor, id, version, p = patch(), inFarm = farm) =>
      asServiceRole(db, async () => (await db.query('select * from public.channel_update_record($1, $2, $3, $4, $5::jsonb)', [actor, inFarm, id, version, p])).rows);

    it('lets the author complete their own open record, which moves to review', async () => {
      const r = await newRecord();
      const rows = await update(crew, r.id, r.version);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'pending_review', version: r.version + 1 });
      expect(rows[0].payload.product).toBe('Neem');
    });

    it('credits the change to the person it was made for in the history', async () => {
      const r = await newRecord();
      await update(crew, r.id, r.version);
      const rev = (await db.query('select changed_by, change_type from public.record_revisions where record_id = $1 and version = $2', [r.id, r.version + 1])).rows[0];
      expect(rev).toMatchObject({ changed_by: crew });
    });

    it.each([
      ['someone else’s record', async () => { const r = await newRecord({ by: owner }); return [crew, r]; }],
      ['a record already in review', async () => { const r = await newRecord({ status: 'pending_review', payload: { activity_type: 'spray', field: 'B2', product: 'x', rate: 'y', target: 'z' }, missing: [] }); return [crew, r]; }],
      ['a stale version', async () => { const r = await newRecord(); return [crew, { ...r, version: r.version + 5 }]; }],
    ])('changes nothing for %s', async (_n, setup) => {
      const [actor, r] = await setup();
      expect(await update(actor, r.id, r.version)).toEqual([]);
    });

    it('cannot approve: the status it may write is limited, and the record guard still applies', async () => {
      const r = await newRecord();
      await expect(update(crew, r.id, r.version, patch({ status: 'approved' }))).rejects.toThrow(/can only leave a record waiting/);
      await expect(update(crew, r.id, r.version, patch({ status: 'pending_review', missing_fields: ['rate'] }))).rejects.toThrow(/incomplete/i);
    });

    it('is checked against the farm in SQL too: the wrong farm, or a user who is not a member of it, changes nothing', async () => {
      const r = await newRecord();
      expect(await update(crew, r.id, r.version, patch(), outsiderFarm)).toEqual([]);
      const stranger = await signUp(db, { email: 'ch-stranger@example.com' });
      const strangerFarm = await farmIdOf(db, stranger);
      const theirs = (await db.query(`insert into public.records (farm_id, kind, status, payload, missing_fields, created_by, source, source_ref) values ($1, 'activity', 'needs_info', '{"activity_type":"spray","field":"B2"}'::jsonb, array['product','rate','target'], $2, 'telegram', $3) returning id, version`, [strangerFarm, stranger, `tg-${Math.random()}`])).rows[0];
      // The author is right and the record's farm is right, but they are not a member of the farm they claim.
      expect(await update(crew, theirs.id, theirs.version, patch(), strangerFarm)).toEqual([]);
    });

    it('rejects the wrong farm even for a person who belongs to both farms', async () => {
      const both = await signUp(db, { email: 'ch-both@example.com' });
      const bothHome = await farmIdOf(db, both);
      await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1, $2, 'crew')`, [farm, both]);
      const r = (await db.query(`insert into public.records (farm_id, kind, status, payload, missing_fields, created_by, source, source_ref) values ($1, 'activity', 'needs_info', '{"activity_type":"spray","field":"B2"}'::jsonb, array['product','rate','target'], $2, 'telegram', $3) returning id, version`, [farm, both, `tg-${Math.random()}`])).rows[0];
      expect(await update(both, r.id, r.version, patch(), bothHome)).toEqual([]); // member of bothHome, but the record is in `farm`
      expect(await update(both, r.id, r.version, patch(), farm)).toHaveLength(1); // the right farm works
    });

    it('rejects an author who has since left the record’s farm', async () => {
      const leaver = await signUp(db, { email: 'ch-left@example.com' });
      await db.query(`insert into public.farm_members (farm_id, user_id, role) values ($1, $2, 'crew')`, [farm, leaver]);
      const r = (await db.query(`insert into public.records (farm_id, kind, status, payload, missing_fields, created_by, source, source_ref) values ($1, 'activity', 'needs_info', '{"activity_type":"spray","field":"B2"}'::jsonb, array['product','rate','target'], $2, 'telegram', $3) returning id, version`, [farm, leaver, `tg-${Math.random()}`])).rows[0];
      await db.query('delete from public.farm_members where user_id = $1 and farm_id = $2', [leaver, farm]);
      expect(await update(leaver, r.id, r.version, patch(), farm)).toEqual([]);
    });

    it('is for the server only', async () => {
      const r = await newRecord();
      await expect(asUser(db, crew, () => db.query('select * from public.channel_update_record($1, $2, $3, $4, $5::jsonb)', [crew, farm, r.id, r.version, patch()]))).rejects.toThrow(/permission denied/i);
    });
  });

  describe('which bot message belongs to which record (channel_messages)', () => {
    it('forgets a chat’s messages when it is unlinked, by anyone (the person in the app, /stop, or account deletion)', async () => {
      await link(owner, 'tg-cleanup');
      const r = (await db.query(`insert into public.records (farm_id, kind, status, payload, missing_fields, created_by, source) values ($1, 'note', 'needs_info', '{}'::jsonb, array['text'], $2, 'telegram') returning id`, [farm, owner])).rows[0];
      await db.query(`insert into public.channel_messages (provider, chat_id, message_id, record_id) values ('telegram', 'tg-cleanup', 1, $1)`, [r.id]);
      await asUser(db, owner, () => db.query(`delete from public.channel_identities where external_id = 'tg-cleanup'`));
      expect((await db.query(`select count(*)::int as n from public.channel_messages where chat_id = 'tg-cleanup'`)).rows[0].n).toBe(0);
    });

    it('is closed to clients', async () => {
      await expect(asUser(db, owner, () => db.query('select * from public.channel_messages'))).rejects.toThrow(/permission denied/i);
      await expect(asAnon(db, () => db.query('select * from public.channel_messages'))).rejects.toThrow(/permission denied/i);
    });

    it('lets the server remember a message once and look it up', async () => {
      const r = (await db.query(`insert into public.records (farm_id, kind, status, payload, missing_fields, created_by, source) values ($1, 'note', 'needs_info', '{}'::jsonb, array['text'], $2, 'telegram') returning id`, [farm, crew])).rows[0];
      await asServiceRole(db, () => db.query(`insert into public.channel_messages (provider, chat_id, message_id, record_id) values ('telegram', '42', 7, $1)`, [r.id]));
      const found = await asServiceRole(db, async () => (await db.query(`select record_id from public.channel_messages where provider = 'telegram' and chat_id = '42' and message_id = 7`)).rows);
      expect(found).toEqual([{ record_id: r.id }]);
    });
  });

  it('is safe to re-run', async () => {
    const sql = (await import('./harness.js')).migrationSql().at(-1);
    await db.exec(sql);
    const { code } = await makeCode(owner);
    expect((await consume(code, 'tg-rerun')).length).toBe(1);
  });
});
