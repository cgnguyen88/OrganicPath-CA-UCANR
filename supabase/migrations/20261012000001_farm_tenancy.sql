-- Phase 0 / 1 of 3: farm tenancy.
--
-- Every account owns (or belongs to) a farm; farm data is walled off by RLS.
-- Safe to re-run. Object names are prefixed/unique so they cannot clobber
-- functions or triggers that already exist in the project (e.g. handle_new_user).
--
-- Membership is SERVER-WRITTEN ONLY. Clients can read their farms and members
-- but cannot insert, update or delete farm_members. Adding teammates arrives in
-- Phase 1 as an invite/accept flow (SECURITY DEFINER function): letting an owner
-- insert arbitrary user_ids would let them pull a stranger's data into their farm.

-- ─── Farms ───────────────────────────────────────────────────────────────────

-- Human-friendly code shown to users and support. NOT a secret and NOT for
-- authorization: it uses random(), which is not cryptographically secure.
create or replace function public.generate_farm_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L
  candidate text;
  i int;
begin
  loop
    candidate := 'F-';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.farms f where f.farm_code = candidate);
  end loop;
  return candidate;
end;
$$;

create table if not exists public.farms (
  id                 uuid primary key default gen_random_uuid(),
  farm_code          text not null unique default public.generate_farm_code(),
  name               text not null check (char_length(name) between 1 and 120),
  season_start_month smallint not null default 1 check (season_start_month between 1 and 12),
  season_start_day   smallint not null default 1 check (season_start_day between 1 and 31),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists farms_created_by_idx on public.farms (created_by);

create or replace function public.farms_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists farms_touch_updated_at on public.farms;
create trigger farms_touch_updated_at
  before update on public.farms
  for each row execute function public.farms_touch_updated_at();

-- ─── Membership ──────────────────────────────────────────────────────────────

create table if not exists public.farm_members (
  farm_id    uuid not null references public.farms (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'manager', 'crew')),
  created_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create index if not exists farm_members_user_id_idx on public.farm_members (user_id);

-- Policy helpers. SECURITY DEFINER so policies on farm_members can consult
-- farm_members without recursing into their own RLS. `(select auth.uid())` lets
-- Postgres evaluate the caller once per statement instead of once per row.
create or replace function public.my_farm_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.farm_id from public.farm_members m where m.user_id = (select auth.uid());
$$;

create or replace function public.is_farm_member(p_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.farm_members m
    where m.farm_id = p_farm_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_farm_role(p_farm_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.farm_members m
    where m.farm_id = p_farm_id and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

revoke all on function public.my_farm_ids() from public, anon;
revoke all on function public.is_farm_member(uuid) from public, anon;
revoke all on function public.has_farm_role(uuid, text[]) from public, anon;
grant execute on function public.my_farm_ids() to authenticated;
grant execute on function public.is_farm_member(uuid) to authenticated;
grant execute on function public.has_farm_role(uuid, text[]) to authenticated;

-- ─── Provisioning ────────────────────────────────────────────────────────────

-- Idempotent: returns the user's existing farm, or creates one with the user as
-- owner. Internal only; clients go through ensure_my_farm().
create or replace function public.ensure_farm_for_user(
  p_user_id       uuid,
  p_farm_name     text default null,
  p_fallback_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_farm_id uuid;
  v_name    text;
begin
  -- Serialize concurrent calls for the same user so only one farm is created.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- "The user's farm" is their oldest membership. That is only safe while membership is
  -- server-written (see header). When Phase 1 adds invites, add an explicit active_farm_id
  -- instead: a client-influenced created_at would let someone pull a user into their farm.
  select m.farm_id into v_farm_id
  from public.farm_members m
  where m.user_id = p_user_id
  order by m.created_at
  limit 1;

  if v_farm_id is not null then
    return v_farm_id;
  end if;

  v_name := nullif(btrim(left(btrim(coalesce(p_farm_name, '')), 120)), '');
  if v_name is null then
    v_name := coalesce(nullif(btrim(left(btrim(coalesce(p_fallback_name, '')), 100)), ''), 'My') || '''s Farm';
  end if;

  insert into public.farms (name, created_by) values (v_name, p_user_id) returning id into v_farm_id;
  insert into public.farm_members (farm_id, user_id, role) values (v_farm_id, p_user_id, 'owner');
  return v_farm_id;
end;
$$;

-- Self-heal entry point for the app: call after sign-in. Needs a signed-in user.
create or replace function public.ensure_my_farm()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_meta jsonb;
  v_mail text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select u.raw_user_meta_data, u.email into v_meta, v_mail from auth.users u where u.id = v_uid;

  return public.ensure_farm_for_user(
    v_uid,
    v_meta ->> 'farm_name',
    coalesce(nullif(v_meta ->> 'name', ''), split_part(coalesce(v_mail, ''), '@', 1))
  );
end;
$$;

-- A new auth user gets a farm. Failure must never block sign-up: warn and let
-- ensure_my_farm() repair it on first login.
create or replace function public.provision_farm_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_farm_for_user(
    new.id,
    new.raw_user_meta_data ->> 'farm_name',
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1))
  );
  return new;
exception when others then
  raise warning 'provision_farm_for_new_user: could not create farm for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_provision_farm on auth.users;
create trigger on_auth_user_created_provision_farm
  after insert on auth.users
  for each row execute function public.provision_farm_for_new_user();

-- Backfill: every existing account gets a farm (idempotent).
do $$
declare
  r record;
begin
  for r in
    select u.id, u.email, u.raw_user_meta_data as meta
    from auth.users u
    where not exists (select 1 from public.farm_members m where m.user_id = u.id)
  loop
    perform public.ensure_farm_for_user(
      r.id,
      r.meta ->> 'farm_name',
      coalesce(nullif(r.meta ->> 'name', ''), split_part(coalesce(r.email, ''), '@', 1))
    );
  end loop;
end;
$$;

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.farms enable row level security;
alter table public.farm_members enable row level security;

drop policy if exists farms_select_member on public.farms;
create policy farms_select_member on public.farms
  for select to authenticated
  using (id in (select public.my_farm_ids()));

drop policy if exists farms_update_owner_manager on public.farms;
create policy farms_update_owner_manager on public.farms
  for update to authenticated
  using (public.has_farm_role(id, array['owner', 'manager']))
  with check (public.has_farm_role(id, array['owner', 'manager']));

drop policy if exists farm_members_select_same_farm on public.farm_members;
create policy farm_members_select_same_farm on public.farm_members
  for select to authenticated
  using (farm_id in (select public.my_farm_ids()));

-- Deliberately NO insert/update/delete policies on farm_members (see header), and
-- none for insert/delete on farms: they are written only by the functions above.
-- Drop any a previous version of this file created.
drop policy if exists farm_members_insert_owner on public.farm_members;
drop policy if exists farm_members_update_owner on public.farm_members;
drop policy if exists farm_members_delete_owner on public.farm_members;

-- ─── Privileges (defense in depth) ───────────────────────────────────────────
-- Supabase grants ALL on new public tables to anon and authenticated, including
-- TRUNCATE, which bypasses RLS. Reduce them to what the app needs; RLS then
-- narrows further. service_role is untouched.

revoke all on public.farms from anon, authenticated;
revoke all on public.farm_members from anon, authenticated;
grant select on public.farms to authenticated;
-- Managers may rename the farm and set season dates; id, farm_code and created_by are immutable.
grant update (name, season_start_month, season_start_day) on public.farms to authenticated;
grant select on public.farm_members to authenticated;

-- Internal functions: not callable by clients.
revoke all on function public.generate_farm_code() from public, anon, authenticated;
revoke all on function public.farms_touch_updated_at() from public, anon, authenticated;
revoke all on function public.provision_farm_for_new_user() from public, anon, authenticated;
revoke all on function public.ensure_farm_for_user(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ensure_my_farm() from public, anon;
grant execute on function public.ensure_my_farm() to authenticated;

-- KNOWN GAP (Phase 1): deleting a farm's last member leaves an ownerless farm.
