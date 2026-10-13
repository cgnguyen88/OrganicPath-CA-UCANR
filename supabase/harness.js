import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared test harness: a real Postgres (PGlite) with stand-ins for Supabase's auth and storage,
// helpers to act as a signed-in user / the anonymous role, and the migrations under test.

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
export const migrationSql = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));

// Minimal stand-ins for the parts of Supabase the migrations rely on.
const ROLES = `
  create role anon nologin;
  create role authenticated nologin;
`;

// Older Supabase projects hand every new public table to anon/authenticated. A brand-new
// project may not, so the migrations must not depend on this.
const DEFAULT_GRANTS = `alter default privileges in schema public grant all on tables to anon, authenticated;`;

const SCHEMAS = `
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql as
    $$ declare parts text[]; begin parts := string_to_array(name, '/'); return parts[1:array_length(parts, 1) - 1]; end $$;

  grant usage on schema auth, storage to anon, authenticated;
  grant all on all tables in schema storage to anon, authenticated;
`;

// The app's existing tables in their OLD shape, plus the worst-case legacy state:
// a wide-open policy and a public storage bucket.
const LEGACY_TABLES = `
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    operation_data jsonb,
    updated_at timestamptz default now()
  );
  create table public.receipts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade,
    date date, supplier text, product text, category text, omri_listed text,
    quantity numeric, unit text, total_cost numeric, invoice_number text, notes text,
    file_name text, file_url text, added_at timestamptz default now()
  );

  alter table public.receipts enable row level security;
  create policy legacy_allow_everything on public.receipts for all using (true) with check (true);
  insert into storage.buckets (id, name, public) values ('receipts', 'receipts', true);

  -- an unrelated bucket whose policy must NOT be collateral damage
  insert into storage.buckets (id, name, public) values ('receipts-archive', 'receipts-archive', false);
  create policy archive_read on storage.objects for select to authenticated using (bucket_id = 'receipts-archive');
`;

export const LEGACY_USERS = {
  alice: '11111111-1111-1111-1111-111111111111',
  bob: '22222222-2222-2222-2222-222222222222',
};
const LEGACY_SEED = `
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${LEGACY_USERS.alice}', 'alice@example.com', '{"name":"Alice"}'),
    ('${LEGACY_USERS.bob}',   'bob@example.com',   '{}');
  insert into public.profiles (id, operation_data) values ('${LEGACY_USERS.alice}', '{"farm":"alice"}');
  insert into public.receipts (user_id, supplier, product) values
    ('${LEGACY_USERS.alice}', 'Acme', 'Legacy compost'),
    ('${LEGACY_USERS.bob}',   'Bobco', 'Legacy kelp');
`;

export async function freshDb({ seed = true, legacySql = '', legacy = true, defaultGrants = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(ROLES);
    if (defaultGrants) await db.exec(DEFAULT_GRANTS);
    await db.exec(SCHEMAS);
    if (legacy) await db.exec(LEGACY_TABLES);
    if (legacy && seed) await db.exec(LEGACY_SEED);
    if (legacySql) await db.exec(legacySql);
    for (const sql of migrationSql()) await db.exec(sql);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function signUp(db, { email, meta = {} }) {
  const { rows } = await db.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id',
    [email, JSON.stringify(meta)],
  );
  return rows[0].id;
}

export async function asUser(db, userId, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function asAnon(db, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}

export const farmIdOf = async (db, userId) =>
  (await db.query('select farm_id from public.farm_members where user_id = $1', [userId])).rows[0]?.farm_id;

