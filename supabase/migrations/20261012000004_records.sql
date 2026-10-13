-- Phase 1: farm records, their change history, and saved views.
--
-- Design rules enforced HERE (not only in the UI), because these are compliance records:
--   * Crew submit; only owners and managers approve, reject or void.
--   * Records are never deleted. Wrong or withdrawn ones are voided, and voided is final.
--   * Every creation, edit and status change writes an immutable revision (who, when, before, after).
--   * The server stamps author, version and reviewer; clients cannot set them.
--   * An incomplete record can be a draft or "needs info", but cannot enter review or approval.
-- The allowed kinds/statuses/sources mirror src/domain/records/kinds.js (a test keeps them in sync).

-- ─── Records ─────────────────────────────────────────────────────────────────

create table if not exists public.records (
  id             uuid primary key default gen_random_uuid(),
  farm_id        uuid not null references public.farms (id) on delete restrict,
  kind           text not null,
  status         text not null default 'pending_review',
  record_date    date,
  payload        jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}',
  confidence     numeric(4, 3),
  source         text not null default 'manual',
  source_ref     text,
  fingerprint    text,
  attachments    jsonb not null default '[]'::jsonb,
  created_by     uuid references auth.users (id) on delete set null,
  reviewed_by    uuid references auth.users (id) on delete set null,
  reviewed_at    timestamptz,
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint records_kind_check check (kind in ('activity', 'purchase', 'note', 'seed', 'planting', 'amendment', 'harvest', 'input', 'inventory')),
  constraint records_status_check check (status in ('draft', 'needs_info', 'pending_review', 'approved', 'rejected', 'voided')),
  constraint records_source_check check (source in ('manual', 'web_upload', 'telegram', 'whatsapp', 'email', 'import')),
  constraint records_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  constraint records_attachments_check check (jsonb_typeof(attachments) = 'array' and pg_column_size(attachments) <= 65536),
  constraint records_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists records_farm_kind_date_idx on public.records (farm_id, kind, record_date desc);
create index if not exists records_farm_status_idx on public.records (farm_id, status);
create index if not exists records_farm_fingerprint_idx on public.records (farm_id, fingerprint) where fingerprint is not null;
create index if not exists records_created_by_idx on public.records (created_by);
create index if not exists records_reviewed_by_idx on public.records (reviewed_by);
-- Hard de-duplication for ingestion channels: the same message/file is never imported twice.
create unique index if not exists records_farm_source_ref_uq on public.records (farm_id, source_ref) where source_ref is not null;

-- ─── Change history ──────────────────────────────────────────────────────────

create table if not exists public.record_revisions (
  id          bigint generated always as identity primary key,
  record_id   uuid not null references public.records (id) on delete restrict,
  farm_id     uuid not null references public.farms (id) on delete restrict,
  version     integer not null,
  change_type text not null,
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now(),
  before      jsonb,
  after       jsonb,
  unique (record_id, version)
);

create index if not exists record_revisions_farm_changed_idx on public.record_revisions (farm_id, changed_at desc);
create index if not exists record_revisions_changed_by_idx on public.record_revisions (changed_by);

-- ─── Guard + versioning trigger ──────────────────────────────────────────────

create or replace function public.records_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  allowed boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, uid);
    new.version := 1;
    new.updated_at := now();
    if new.status = 'approved' then
      new.reviewed_by := uid;
      new.reviewed_at := now();
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
  else
    -- Account erasure: deleting a user makes the foreign keys SET NULL on created_by and/or
    -- reviewed_by. That is not an edit of the record (no new version, allowed even on voided
    -- records); anything else changing alongside it is still checked below.
    if ((old.created_by is not null and new.created_by is null) or (old.reviewed_by is not null and new.reviewed_by is null))
       and (new.created_by is null or new.created_by is not distinct from old.created_by)
       and (new.reviewed_by is null or new.reviewed_by is not distinct from old.reviewed_by)
       and (to_jsonb(new) - 'created_by' - 'reviewed_by' - 'updated_at') = (to_jsonb(old) - 'created_by' - 'reviewed_by' - 'updated_at') then
      return new;
    end if;

    if old.status = 'voided' then
      raise exception 'Voided records cannot be changed' using errcode = '23514';
    end if;
    if new.id is distinct from old.id
       or new.farm_id is distinct from old.farm_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.source is distinct from old.source
       or new.source_ref is distinct from old.source_ref then
      raise exception 'Immutable record columns cannot be changed' using errcode = '23514';
    end if;

    if new.status is distinct from old.status then
      allowed := case old.status
        when 'draft' then new.status in ('needs_info', 'pending_review', 'voided')
        when 'needs_info' then new.status in ('draft', 'pending_review', 'voided')
        when 'pending_review' then new.status in ('approved', 'rejected', 'needs_info', 'voided')
        when 'approved' then new.status in ('voided')
        when 'rejected' then new.status in ('pending_review', 'voided')
        else false
      end;
      if not allowed then
        raise exception 'Invalid status change: % -> %', old.status, new.status using errcode = '23514';
      end if;
      if new.status in ('approved', 'rejected', 'voided') then
        new.reviewed_by := coalesce(uid, old.reviewed_by);
        new.reviewed_at := now();
      else
        new.reviewed_by := null;
        new.reviewed_at := null;
      end if;
    else
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;

    -- An update that changes nothing is not a new version and does not belong in the history.
    if (to_jsonb(new) - 'updated_at' - 'version') = (to_jsonb(old) - 'updated_at' - 'version') then
      return old;
    end if;

    new.version := old.version + 1;
    new.updated_at := now();
  end if;

  if new.status in ('pending_review', 'approved') then
    if cardinality(new.missing_fields) > 0 then
      raise exception 'Record is incomplete: missing %', array_to_string(new.missing_fields, ', ') using errcode = '23514';
    end if;
    -- The client reports what is missing, so the database cannot rely on that alone: a record
    -- with no details at all is never ready for review.
    if new.payload = '{}'::jsonb then
      raise exception 'Record is incomplete: no details' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write
  before insert or update on public.records
  for each row execute function public.records_before_write();

-- Revisions are written by the database, never by clients.
create or replace function public.records_write_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Account erasure and no-op updates leave the version unchanged: nothing to record.
  if tg_op = 'UPDATE' and new.version = old.version then
    return null;
  end if;

  insert into public.record_revisions (record_id, farm_id, version, change_type, changed_by, before, after)
  values (
    new.id,
    new.farm_id,
    new.version,
    case
      when tg_op = 'INSERT' then 'created'
      when new.status is distinct from old.status then 'status:' || new.status
      else 'edited'
    end,
    (select auth.uid()),
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return null;
end;
$$;

drop trigger if exists records_write_revision on public.records;
create trigger records_write_revision
  after insert or update on public.records
  for each row execute function public.records_write_revision();

-- ─── Saved views ─────────────────────────────────────────────────────────────

create table if not exists public.saved_views (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references public.farms (id) on delete cascade,
  slug       text check (slug is null or slug ~ '^[a-z0-9-]{1,60}$'),
  name       text not null check (char_length(name) between 1 and 80),
  filter     jsonb not null check (jsonb_typeof(filter) = 'object'),
  pinned     boolean not null default true,
  position   integer not null default 0,
  is_default boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists saved_views_farm_slug_uq on public.saved_views (farm_id, slug) where slug is not null;
create index if not exists saved_views_farm_idx on public.saved_views (farm_id, position);
create index if not exists saved_views_created_by_idx on public.saved_views (created_by);

-- The pinned views every farm starts with (kept identical to DEFAULT_SAVED_VIEWS in
-- src/domain/records/savedViews.js; a test compares them).
create or replace function public.seed_default_saved_views(p_farm_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.saved_views (farm_id, slug, name, filter, pinned, position, is_default)
  values
    (p_farm_id, 'purchases-without-omri', 'Purchases without OMRI listing',
     '{"kinds":["purchase"],"status":["approved"],"season":"all","where":[{"field":"payload.omri_status","op":"nin","value":["listed","not_applicable"]}]}'::jsonb, true, 1, true),
    (p_farm_id, 'this-seasons-sprays', 'This season’s sprays',
     '{"kinds":["activity"],"status":["approved"],"season":"current","where":[{"field":"payload.activity_type","op":"eq","value":"spray"}]}'::jsonb, true, 2, true),
    (p_farm_id, 'this-seasons-harvests', 'This season’s harvests',
     '{"kinds":["harvest"],"status":["approved"],"season":"current","where":[]}'::jsonb, true, 3, true),
    (p_farm_id, 'this-seasons-purchases', 'This season’s purchases',
     '{"kinds":["purchase"],"status":["approved"],"season":"current","where":[]}'::jsonb, true, 4, true)
  on conflict (farm_id, slug) where slug is not null do nothing;
$$;

create or replace function public.farms_seed_default_views()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_default_saved_views(new.id);
  return new;
end;
$$;

drop trigger if exists farms_seed_default_views on public.farms;
create trigger farms_seed_default_views
  after insert on public.farms
  for each row execute function public.farms_seed_default_views();

-- Farms that already exist.
select public.seed_default_saved_views(f.id) from public.farms f;

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.records enable row level security;
alter table public.record_revisions enable row level security;
alter table public.saved_views enable row level security;

drop policy if exists records_select_farm on public.records;
create policy records_select_farm on public.records
  for select to authenticated
  using (farm_id in (select public.my_farm_ids()));

-- Crew may submit for review; only owners/managers may create an already-approved record.
drop policy if exists records_insert_farm on public.records;
create policy records_insert_farm on public.records
  for insert to authenticated
  with check (
    farm_id in (select public.my_farm_ids())
    and created_by = (select auth.uid())
    and (
      status in ('draft', 'needs_info', 'pending_review')
      or (status = 'approved' and public.has_farm_role(farm_id, array['owner', 'manager']))
    )
  );

-- Owners/managers edit and review anything in their farm; crew edit only their own unreviewed records.
drop policy if exists records_update_farm on public.records;
create policy records_update_farm on public.records
  for update to authenticated
  using (
    farm_id in (select public.my_farm_ids())
    and (
      public.has_farm_role(farm_id, array['owner', 'manager'])
      or (created_by = (select auth.uid()) and status in ('draft', 'needs_info', 'pending_review'))
    )
  )
  with check (
    farm_id in (select public.my_farm_ids())
    and (
      public.has_farm_role(farm_id, array['owner', 'manager'])
      or (created_by = (select auth.uid()) and status in ('draft', 'needs_info', 'pending_review'))
    )
  );
-- No delete policy: records are voided, never deleted.

drop policy if exists record_revisions_select_farm on public.record_revisions;
create policy record_revisions_select_farm on public.record_revisions
  for select to authenticated
  using (farm_id in (select public.my_farm_ids()));

drop policy if exists saved_views_select_farm on public.saved_views;
create policy saved_views_select_farm on public.saved_views
  for select to authenticated
  using (farm_id in (select public.my_farm_ids()));

drop policy if exists saved_views_insert_manager on public.saved_views;
create policy saved_views_insert_manager on public.saved_views
  for insert to authenticated
  with check (public.has_farm_role(farm_id, array['owner', 'manager']) and created_by = (select auth.uid()));

drop policy if exists saved_views_update_manager on public.saved_views;
create policy saved_views_update_manager on public.saved_views
  for update to authenticated
  using (public.has_farm_role(farm_id, array['owner', 'manager']))
  with check (public.has_farm_role(farm_id, array['owner', 'manager']));

drop policy if exists saved_views_delete_manager on public.saved_views;
create policy saved_views_delete_manager on public.saved_views
  for delete to authenticated
  using (public.has_farm_role(farm_id, array['owner', 'manager']) and not is_default);

-- ─── Privileges (column-level: defense in depth) ─────────────────────────────

revoke all on public.records, public.record_revisions, public.saved_views from anon, authenticated;

grant select on public.records to authenticated;
-- Server-controlled columns (id, created_by, version, reviewed_by/at, timestamps) are not grantable.
-- `source` and `source_ref` are provenance and dedupe keys: set only by the server paths that
-- ingest (the bridge below, the import, and later the agent), never by a client.
grant insert (farm_id, kind, status, record_date, payload, missing_fields, confidence, fingerprint, attachments)
  on public.records to authenticated;
grant update (record_date, payload, status, missing_fields, confidence, fingerprint, attachments)
  on public.records to authenticated;

grant select on public.record_revisions to authenticated;

grant select on public.saved_views to authenticated;
grant insert (farm_id, name, filter, pinned, position) on public.saved_views to authenticated;
grant update (name, filter, pinned, position) on public.saved_views to authenticated;
grant delete on public.saved_views to authenticated;

revoke all on function public.records_before_write() from public, anon, authenticated;
revoke all on function public.records_write_revision() from public, anon, authenticated;
revoke all on function public.seed_default_saved_views(uuid) from public, anon, authenticated;
revoke all on function public.farms_seed_default_views() from public, anon, authenticated;

-- ─── Receipts → purchase records ─────────────────────────────────────────────
-- The Receipt Manager page still writes to `receipts`. One mapping turns a receipt into a
-- purchase payload; it is used for the one-time import below and by the live bridge in
-- migration 5, so both always agree.

create or replace function public.receipt_purchase_payload(r public.receipts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'supplier', nullif(btrim(left(coalesce(r.supplier, ''), 200)), ''),
    'product', nullif(btrim(left(coalesce(r.product, ''), 200)), ''),
    'category', case
      when btrim(coalesce(r.category, '')) = '' then null
      when lower(btrim(r.category)) in ('fertilizer', 'fertilizante') then 'fertilizer'
      when lower(btrim(r.category)) in ('pesticide/herbicide', 'pesticida/herbicida') then 'pest_control'
      when lower(btrim(r.category)) in ('seed/transplant', 'semilla/trasplante') then 'seed'
      when lower(btrim(r.category)) in ('soil amendment', 'enmienda del suelo') then 'amendment'
      when lower(btrim(r.category)) in ('cover crop', 'cultivo de cobertura') then 'cover_crop'
      when lower(btrim(r.category)) in ('equipment', 'equipo') then 'equipment'
      when lower(btrim(r.category)) in ('livestock feed', 'alimento para ganado') then 'livestock_feed'
      else 'other'
    end,
    'omri_status', case lower(btrim(coalesce(r.omri_listed, '')))
      when 'yes' then 'listed'
      when 'no' then 'not_listed'
      else 'unknown'
    end,
    'quantity', r.quantity,
    'unit', nullif(btrim(left(coalesce(r.unit, ''), 200)), ''),
    'total_cost', r.total_cost,
    'invoice_number', nullif(btrim(left(coalesce(r.invoice_number, ''), 200)), ''),
    'notes', nullif(btrim(left(coalesce(r.notes, ''), 2000)), '')
  ));
$$;

-- What a receipt lacks to be a complete purchase record (a purchase needs a supplier and a product).
create or replace function public.receipt_missing_fields(r public.receipts)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array_remove(array[
    case when nullif(btrim(coalesce(r.supplier, '')), '') is null then 'supplier' end,
    case when nullif(btrim(coalesce(r.product, '')), '') is null then 'product' end
  ], null);
$$;

create or replace function public.receipt_attachments(r public.receipts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when r.file_path is not null
              then jsonb_build_array(jsonb_build_object('path', left(r.file_path, 500), 'name', left(r.file_name, 200)))
              else '[]'::jsonb end;
$$;

revoke all on function public.receipt_purchase_payload(public.receipts) from public, anon, authenticated;
revoke all on function public.receipt_attachments(public.receipts) from public, anon, authenticated;
revoke all on function public.receipt_missing_fields(public.receipts) from public, anon, authenticated;

-- One-time and idempotent import (unique farm_id + source_ref). The receipts table is left in place.
insert into public.records (farm_id, kind, status, record_date, payload, missing_fields, source, source_ref, created_by, attachments, created_at)
select
  r.farm_id, 'purchase', case when cardinality(public.receipt_missing_fields(r)) > 0 then 'needs_info' else 'approved' end, r.date,
  public.receipt_purchase_payload(r), public.receipt_missing_fields(r),
  'import', 'receipt:' || r.id, r.user_id,
  public.receipt_attachments(r),
  coalesce(r.added_at, now())
from public.receipts r
where r.farm_id is not null
on conflict (farm_id, source_ref) where source_ref is not null do nothing;
