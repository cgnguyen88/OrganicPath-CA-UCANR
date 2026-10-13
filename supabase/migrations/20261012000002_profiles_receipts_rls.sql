-- Phase 0 / 2 of 3: lock down the two tables the app already uses.
--
-- REVIEW BEFORE APPLYING. This repo had no migrations, so the live policies on
-- `profiles` and `receipts` are undocumented. This file DROPS EVERY EXISTING
-- POLICY on those two tables and replaces them with an explicit, tested set.
-- Permissive policies are OR-ed together, so a single leftover `using (true)`
-- would silently defeat everything below. Run supabase/verify/list_policies.sql
-- first to see what will be replaced.
--
-- Receipts have NO update policy on purpose: the app never edits a saved receipt,
-- and these are compliance records. Editing arrives in Phase 1 with revision history.

-- ─── Scope receipts to a farm (before any policy is touched) ─────────────────

alter table public.receipts add column if not exists farm_id uuid references public.farms (id) on delete restrict;
-- Storage path of the uploaded file. Replaces long-lived signed URLs in file_url:
-- the app mints a short-lived URL from this path whenever a file is viewed.
alter table public.receipts add column if not exists file_path text;

update public.receipts r
set farm_id = (
  select m.farm_id from public.farm_members m
  where m.user_id = r.user_id
  order by m.created_at
  limit 1
)
where r.farm_id is null;

-- Refuse to proceed if any row would become invisible to everyone (RLS hides rows
-- whose farm_id is null). Fix or remove them first, then re-run.
do $$
declare
  orphans bigint;
begin
  select count(*) into orphans from public.receipts where farm_id is null;
  if orphans > 0 then
    raise exception 'Cannot apply: % receipts row(s) have no farm (user_id is null, or that user has no farm). Assign or delete them, then re-run.', orphans;
  end if;
end;
$$;

create index if not exists receipts_farm_id_idx on public.receipts (farm_id);
create index if not exists receipts_user_id_idx on public.receipts (user_id);

-- Keeps the current client working while it does not yet send farm_id.
create or replace function public.receipts_default_farm()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.farm_id is null then
    select m.farm_id into new.farm_id
    from public.farm_members m
    where m.user_id = coalesce((select auth.uid()), new.user_id)
    order by m.created_at
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists receipts_default_farm on public.receipts;
create trigger receipts_default_farm
  before insert on public.receipts
  for each row execute function public.receipts_default_farm();

-- ─── Remove whatever policies exist today ───────────────────────────────────

do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public' and tablename in ('profiles', 'receipts')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end;
$$;

-- ─── profiles: each user reads and writes only their own row ─────────────────

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ─── receipts: scoped to the farm ────────────────────────────────────────────

alter table public.receipts enable row level security;

create policy receipts_select_farm on public.receipts
  for select to authenticated
  using (farm_id in (select public.my_farm_ids()));

create policy receipts_insert_farm on public.receipts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and farm_id in (select public.my_farm_ids()));

-- Receipts are compliance records: only owners and managers may delete them.
create policy receipts_delete_owner_manager on public.receipts
  for delete to authenticated
  using (public.has_farm_role(farm_id, array['owner', 'manager']));

-- ─── Privileges (defense in depth; see migration 1) ──────────────────────────

revoke all on public.profiles, public.receipts from anon, authenticated;

-- Grant exactly what the app needs. Do not rely on the project's default privileges: a
-- new Supabase project may not grant them. RLS above narrows these further.
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.receipts to authenticated;

revoke all on function public.receipts_default_farm() from public, anon, authenticated;
