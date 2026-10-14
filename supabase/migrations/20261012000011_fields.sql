-- Fields: the named places a farm grows things (a block, a bed, "North 40").
--
-- Records keep a field as text (`payload.field`), so a harvest can be traced back to where it grew. Free text
-- means "B2" and "b-2" are two places; a registry gives each farm one list of names to choose from.
--
-- The rule that matters, enforced HERE and not only in the screen: while ANY record uses a field (any status,
-- voided ones included), its name cannot be changed and it cannot be deleted, so the trail from a harvest back
-- to a field cannot be broken quietly. It can be archived instead, and its area and notes can change.
--
--   * Two spellings are the same field when they differ only in capital letters, spacing (any kind of space, in
--     any number) or invisible characters. `field_key()` is that comparison, written once and used everywhere
--     (the unique index, the guard, the backfill), and it matches `fieldKey()` in src/domain/records/fields.js.
--   * A field's name is stored already tidied (single spaces, nothing invisible, 1 to 60 characters).
--   * Owners and managers add, change, archive and delete; every member of the farm can read.
--   * A farm can have at most 500 fields.
--   * The fields a farm already uses in its APPROVED records are registered once, below (safe to run again).
--
-- Known and accepted: the guard takes no lock, so a record saved in the same instant that its field is renamed
-- or deleted can slip through. The record keeps its text and simply shows as "not in your field list" (an owner
-- can add the name again); nothing is lost. Capital letters are folded by the database's own `lower()`, which
-- can differ from the browser's for a few letters (a final Greek sigma, a dotted capital I).
-- Safe to re-run.

-- ─── How names are compared ──────────────────────────────────────────────────

-- The name as the app tidies it: control characters, direction marks and zero-width characters removed, every run
-- of whitespace (including non-breaking and ideographic spaces) made one plain space, nothing at either end.
-- The characters are written as \u escapes on purpose (this file is pasted into a browser editor, which can drop
-- invisible characters, and a range with a missing end would silently change which letters are removed). The
-- whitespace list is spelled out rather than using \s, which differs between databases.
create or replace function public.field_clean_name(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(t, '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2060\u202a-\u202e\u2066-\u2069\ufffe\uffff]', '', 'g'),
      '[\t\n\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'
    ),
    ' '
  )
$$;

-- What two spellings of a field have in common.
create or replace function public.field_key(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select lower(public.field_clean_name(t)) $$;

-- ─── The table ───────────────────────────────────────────────────────────────

create table if not exists public.fields (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references public.farms (id) on delete cascade,
  name       text not null,
  area       numeric(12, 3),
  area_unit  text,
  notes      text,
  is_active  boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fields_area_check check (area is null or (area >= 0 and area <= 1000000)),
  constraint fields_area_unit_check check (area_unit is null or area_unit in ('acre', 'hectare', 'sq_ft')),
  constraint fields_notes_check check (notes is null or char_length(notes) <= 1000)
);

-- Names are stored tidied, 1 to 60 characters (counted in characters, not bytes).
alter table public.fields drop constraint if exists fields_name_check;
alter table public.fields add constraint fields_name_check check (name = public.field_clean_name(name) and char_length(name) between 1 and 60);

drop index if exists public.fields_farm_name_uq;
create unique index if not exists fields_farm_key_uq on public.fields (farm_id, public.field_key(name));
create index if not exists fields_created_by_idx on public.fields (created_by);

-- Finding the records that use a field (for the rule below, and for a field's history). The key is cut to its
-- first 128 characters so an absurdly long value in a record can never make the index row too large; the
-- full comparison is made on what the index finds.
drop index if exists public.records_farm_field_idx;
create index if not exists records_farm_field_key_idx
  on public.records (farm_id, left(public.field_key(payload->>'field'), 128))
  where jsonb_typeof(payload->'field') = 'string';

-- ─── Keeping a field's name while records use it ─────────────────────────────

create or replace function public.field_is_referenced(p_farm_id uuid, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.records r
    where r.farm_id = p_farm_id
      and jsonb_typeof(r.payload->'field') = 'string'
      and left(public.field_key(r.payload->>'field'), 128) = left(public.field_key(p_name), 128)
      and public.field_key(r.payload->>'field') = public.field_key(p_name)
  );
$$;

create or replace function public.fields_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.field_is_referenced(old.farm_id, old.name) then
      raise exception 'The field "%" is used by records and cannot be deleted. Archive it instead.', old.name using errcode = '23514';
    end if;
    return old;
  end if;

  if new.farm_id <> old.farm_id then
    raise exception 'A field cannot move to another farm.' using errcode = '42501';
  end if;
  -- A change of capital letters is fine: records match a field ignoring them.
  if public.field_key(new.name) <> public.field_key(old.name) and public.field_is_referenced(old.farm_id, old.name) then
    raise exception 'The field "%" is used by records and cannot be renamed.', old.name using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fields_guard on public.fields;
create trigger fields_guard
  before update or delete on public.fields
  for each row execute function public.fields_guard();

-- A farm has at most 500 fields (the app adds at most 50 at a time, but only the database can enforce it).
create or replace function public.fields_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One insert at a time per farm, so two at once cannot both slip under the limit.
  perform pg_advisory_xact_lock(hashtextextended(new.farm_id::text, 0));
  if (select count(*) from public.fields f where f.farm_id = new.farm_id) >= 500 then
    raise exception 'A farm can have at most 500 fields.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists fields_limit on public.fields;
create trigger fields_limit
  before insert on public.fields
  for each row execute function public.fields_limit();

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.fields enable row level security;

drop policy if exists fields_select_farm on public.fields;
create policy fields_select_farm on public.fields
  for select to authenticated
  using (farm_id in (select public.my_farm_ids()));

drop policy if exists fields_insert_manager on public.fields;
create policy fields_insert_manager on public.fields
  for insert to authenticated
  with check (public.has_farm_role(farm_id, array['owner', 'manager']) and created_by = (select auth.uid()));

drop policy if exists fields_update_manager on public.fields;
create policy fields_update_manager on public.fields
  for update to authenticated
  using (public.has_farm_role(farm_id, array['owner', 'manager']))
  with check (public.has_farm_role(farm_id, array['owner', 'manager']));

drop policy if exists fields_delete_manager on public.fields;
create policy fields_delete_manager on public.fields
  for delete to authenticated
  using (public.has_farm_role(farm_id, array['owner', 'manager']));

-- ─── Privileges (column-level: defense in depth) ─────────────────────────────

revoke all on public.fields from anon, authenticated;
grant select on public.fields to authenticated;
-- The farm and the author are set once, at creation (the author by default, from the signed-in person).
grant insert (farm_id, name, area, area_unit, notes) on public.fields to authenticated;
grant update (name, area, area_unit, notes, is_active) on public.fields to authenticated;
grant delete on public.fields to authenticated;

-- (`field_clean_name` and `field_key` stay callable by everyone: the name check and the indexes run them as the
-- person writing. They only compute on the text they are given.)
revoke all on function public.field_is_referenced(uuid, text) from public, anon, authenticated;
revoke all on function public.fields_guard() from public, anon, authenticated;
revoke all on function public.fields_limit() from public, anon, authenticated;

-- ─── The fields a farm already uses ──────────────────────────────────────────

-- Registers every field name found in a farm's APPROVED records (a draft or a rejected record has not been
-- reviewed, so its text is not turned into a field), once per name, spelled the way the records spell it most
-- often. Names that cannot be field names (empty, longer than 60 characters) are skipped, the most used names
-- come first when a farm would pass 500, and a field that is already registered is left exactly as it is.
create or replace function public.backfill_fields_from_records()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  created integer;
begin
  with used as (
    select r.farm_id, public.field_clean_name(r.payload->>'field') as name, count(*) as uses
    from public.records r
    where r.status = 'approved' and jsonb_typeof(r.payload->'field') = 'string'
    group by r.farm_id, public.field_clean_name(r.payload->>'field')
  ),
  keyed as (
    select farm_id, name, uses, public.field_key(name) as key,
           sum(uses) over (partition by farm_id, public.field_key(name)) as total
    from used
    where char_length(name) between 1 and 60
  ),
  best as (
    select distinct on (farm_id, key) farm_id, name, key, total
    from keyed
    order by farm_id, key, uses desc, name
  ),
  fresh as (
    select b.farm_id, b.name, row_number() over (partition by b.farm_id order by b.total desc, b.name) as rank
    from best b
    where not exists (select 1 from public.fields f where f.farm_id = b.farm_id and public.field_key(f.name) = b.key)
  )
  insert into public.fields (farm_id, name)
  select c.farm_id, c.name
  from fresh c
  where c.rank <= greatest(0, 500 - (select count(*) from public.fields f where f.farm_id = c.farm_id))
  on conflict (farm_id, public.field_key(name)) do nothing;

  get diagnostics created = row_count;
  return created;
end;
$$;

revoke all on function public.backfill_fields_from_records() from public, anon, authenticated;

select public.backfill_fields_from_records();
