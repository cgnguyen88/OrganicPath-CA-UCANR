-- Phase 3: chat channels (Telegram first; the tables are provider-neutral).
--
-- Who may message the bot: only people who linked their chat account to their app account. Linking is
-- two steps, so nobody can be linked to a farm they did not choose:
--   1. a signed-in farm member makes a one-time code in the app and opens its link in Telegram;
--   2. the bot tells the Telegram user WHICH farm (and a masked owner email) and waits for them to
--      confirm. Until then the link is "pending" and the chat is still treated as a stranger.
-- Everything here is written by the server (service role) except two things a signed-in user may do for
-- themselves: make a link code, and remove their own links.
--
--   channel_link_codes  one-time, short-lived codes (only a hash is stored)
--   channel_identities  chat account -> app user + farm (pending until confirmed)
--   channel_updates     update ids already handled, so a retried webhook is not processed twice
--   channel_messages    which bot message asked about which record, so a reply finds its record
--
-- The tables tidy themselves: claiming an update also clears a few old rows, so there is no job to schedule.

-- ─── Linked chat accounts ───────────────────────────────────────────────────

create table if not exists public.channel_identities (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null check (provider in ('telegram', 'whatsapp')),
  external_id  text not null check (char_length(external_id) between 1 and 64),
  user_id      uuid not null references auth.users (id) on delete cascade,
  farm_id      uuid not null references public.farms (id) on delete cascade,
  lang         text not null default 'en' check (lang in ('en', 'es')),
  display_name text check (display_name is null or char_length(display_name) <= 64),
  linked_at    timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (provider, external_id)
);

create index if not exists channel_identities_user_idx on public.channel_identities (user_id);

alter table public.channel_identities enable row level security;
revoke all on public.channel_identities from public, anon, authenticated;
grant select, delete on public.channel_identities to authenticated;
grant select, insert, update, delete on public.channel_identities to service_role;

drop policy if exists channel_identities_select_own on public.channel_identities;
create policy channel_identities_select_own on public.channel_identities
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists channel_identities_delete_own on public.channel_identities;
create policy channel_identities_delete_own on public.channel_identities
  for delete to authenticated using (user_id = (select auth.uid()));

-- ─── One-time link codes ────────────────────────────────────────────────────

create table if not exists public.channel_link_codes (
  id         uuid primary key default gen_random_uuid(),
  code_hash  text not null unique,
  user_id    uuid not null references auth.users (id) on delete cascade,
  farm_id    uuid not null references public.farms (id) on delete cascade,
  lang       text not null default 'en' check (lang in ('en', 'es')),
  farm_name  text,
  owner_hint text,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists channel_link_codes_user_idx on public.channel_link_codes (user_id, created_at);

alter table public.channel_link_codes enable row level security;
revoke all on public.channel_link_codes from public, anon, authenticated;
grant select, insert, update, delete on public.channel_link_codes to service_role;

-- A signed-in farm member asks for a code. It is returned once and never stored in the clear. The farm name
-- and a masked email are kept with it, so the Telegram user can see whose farm they are about to join.
-- (The code is a 122-bit random value, so it fits Telegram's /start payload alphabet.)
create or replace function public.create_channel_link_code(p_lang text default 'en')
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_farm uuid;
  my_farm_name text;
  my_email text;
  hint text;
  fresh text;
  expires timestamptz := now() + interval '15 minutes';
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_lang is null or p_lang not in ('en', 'es') then
    raise exception 'Unsupported language' using errcode = '22023';
  end if;

  select m.farm_id, f.name into my_farm, my_farm_name
  from public.farm_members m join public.farms f on f.id = m.farm_id
  where m.user_id = me order by m.created_at asc limit 1;
  if my_farm is null then
    raise exception 'You are not part of a farm yet' using errcode = '42501';
  end if;

  if (select count(*) from public.channel_link_codes c where c.user_id = me and c.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes requested. Try again later.' using errcode = '54000';
  end if;

  delete from public.channel_link_codes c where c.user_id = me and (c.expires_at < now() - interval '1 day' or c.used_at is not null);

  select u.email into my_email from auth.users u where u.id = me;
  hint := case when my_email like '_%@_%' then left(my_email, 1) || '***' || substring(my_email from position('@' in my_email)) end;

  fresh := replace(gen_random_uuid()::text, '-', '');
  insert into public.channel_link_codes (code_hash, user_id, farm_id, lang, farm_name, owner_hint, expires_at)
  values (encode(sha256(convert_to(fresh, 'utf8')), 'hex'), me, my_farm, p_lang, left(my_farm_name, 80), hint, expires);

  return query select fresh, expires;
end;
$$;

revoke all on function public.create_channel_link_code(text) from public, anon;
grant execute on function public.create_channel_link_code(text) to authenticated;

-- Step 1: the server redeems a code for a chat account, creating a PENDING link. Returns no row for an
-- unknown, used or expired code, when its owner has left the farm, or when that chat account is already
-- connected (nobody can re-point a connected chat with their own code; the owner must disconnect first,
-- and in that case the code is left unspent). A still-pending link is simply replaced by the newest code.
create or replace function public.consume_channel_link_code(p_provider text, p_code_hash text, p_external_id text, p_display_name text default null)
returns table (r_user_id uuid, r_farm_id uuid, r_lang text, r_farm_name text, r_owner_hint text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  hit public.channel_link_codes;
  written integer;
begin
  if p_code_hash is null or p_external_id is null then
    return;
  end if;

  select * into hit from public.channel_link_codes c
  where c.code_hash = p_code_hash and c.used_at is null and c.expires_at > now()
  for update;
  if not found then
    return;
  end if;

  if not exists (select 1 from public.farm_members m where m.user_id = hit.user_id and m.farm_id = hit.farm_id) then
    return;
  end if;

  insert into public.channel_identities as i (provider, external_id, user_id, farm_id, lang, display_name, confirmed_at)
  values (p_provider, p_external_id, hit.user_id, hit.farm_id, hit.lang, left(p_display_name, 64), null)
  on conflict (provider, external_id)
  do update set user_id = excluded.user_id, farm_id = excluded.farm_id, lang = excluded.lang,
                display_name = excluded.display_name, linked_at = now(), confirmed_at = null
  where i.confirmed_at is null;
  get diagnostics written = row_count;
  if written = 0 then
    return; -- already connected: leave the code unspent
  end if;

  update public.channel_link_codes set used_at = now() where id = hit.id;
  return query select hit.user_id, hit.farm_id, hit.lang, hit.farm_name, hit.owner_hint;
end;
$$;

revoke all on function public.consume_channel_link_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.consume_channel_link_code(text, text, text, text) to service_role;

-- Step 2: the Telegram user confirms. Only a recent pending link whose owner still belongs to the farm.
create or replace function public.confirm_channel_identity(p_provider text, p_external_id text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  update public.channel_identities i set confirmed_at = now()
  where i.provider = p_provider and i.external_id = p_external_id
    and i.confirmed_at is null and i.linked_at > now() - interval '15 minutes'
    and exists (select 1 from public.farm_members m where m.user_id = i.user_id and m.farm_id = i.farm_id);
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.confirm_channel_identity(text, text) from public, anon, authenticated;
grant execute on function public.confirm_channel_identity(text, text) to service_role;

-- Forget a chat's message links whenever it is unlinked (in the app, with /stop, or by account deletion).
create or replace function public.channel_identity_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.channel_messages where provider = old.provider and chat_id = old.external_id;
  return old;
end;
$$;

-- ─── Retries ────────────────────────────────────────────────────────────────

create table if not exists public.channel_updates (
  provider    text not null check (provider in ('telegram', 'whatsapp')),
  update_id   bigint not null,
  received_at timestamptz not null default now(),
  primary key (provider, update_id)
);

create index if not exists channel_updates_received_idx on public.channel_updates (received_at);

alter table public.channel_updates enable row level security;
revoke all on public.channel_updates from public, anon, authenticated;
grant select, insert, delete on public.channel_updates to service_role;

-- ─── Which message asked about which record ─────────────────────────────────

create table if not exists public.channel_messages (
  provider   text not null check (provider in ('telegram', 'whatsapp')),
  chat_id    text not null check (char_length(chat_id) between 1 and 64),
  message_id bigint not null,
  record_id  uuid not null references public.records (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (provider, chat_id, message_id)
);

create index if not exists channel_messages_created_idx on public.channel_messages (created_at);

alter table public.channel_messages enable row level security;
revoke all on public.channel_messages from public, anon, authenticated;
grant select, insert, delete on public.channel_messages to service_role;

drop trigger if exists channel_identity_cleanup on public.channel_identities;
create trigger channel_identity_cleanup
  after delete on public.channel_identities
  for each row execute function public.channel_identity_cleanup();

-- True the first time an update is seen, false for a retry. Also clears a few expired rows (bounded, so
-- it stays cheap), which keeps these tables small without any scheduled job.
create or replace function public.claim_channel_update(p_provider text, p_update_id bigint)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  inserted integer;
begin
  insert into public.channel_updates (provider, update_id) values (p_provider, p_update_id)
  on conflict do nothing;
  get diagnostics inserted = row_count;

  delete from public.channel_updates where ctid in (select u.ctid from public.channel_updates u where u.received_at < now() - interval '7 days' limit 50);
  delete from public.channel_messages where ctid in (select m.ctid from public.channel_messages m where m.created_at < now() - interval '30 days' limit 50);
  delete from public.channel_link_codes where ctid in (select c.ctid from public.channel_link_codes c where c.expires_at < now() - interval '1 day' limit 50);
  delete from public.channel_identities where ctid in (select i.ctid from public.channel_identities i where i.confirmed_at is null and i.linked_at < now() - interval '1 day' limit 50);

  return inserted = 1;
end;
$$;

revoke all on function public.claim_channel_update(text, bigint) from public, anon, authenticated;
grant execute on function public.claim_channel_update(text, bigint) to service_role;

-- Full housekeeping on request (the same things claim_channel_update does a few rows at a time).
create or replace function public.purge_channel_data()
returns bigint
language sql
security invoker
set search_path = public, pg_temp
as $$
  with a as (delete from public.channel_updates where received_at < now() - interval '7 days' returning 1),
       b as (delete from public.channel_messages where created_at < now() - interval '30 days' returning 1),
       c as (delete from public.channel_link_codes where expires_at < now() - interval '1 day' returning 1),
       d as (delete from public.channel_identities where confirmed_at is null and linked_at < now() - interval '1 day' returning 1)
  select (select count(*) from a) + (select count(*) from b) + (select count(*) from c) + (select count(*) from d)
$$;

revoke all on function public.purge_channel_data() from public, anon, authenticated;
grant execute on function public.purge_channel_data() to service_role;

-- ─── A reply fills in the author's own open record ──────────────────────────
-- The chat has no user session, so row-level security does not apply. The rules live here
-- instead: only the record's author, only in the farm they act in (and they must still belong to it),
-- only while the record is still waiting for details (draft or needs_info), only against the version
-- that was read, and only into the columns a person may edit. The record guard trigger still enforces
-- the status rules (a record in review must be complete, nothing becomes approved), and the history
-- names the author.
create or replace function public.channel_update_record(p_actor uuid, p_farm_id uuid, p_record_id uuid, p_expected_version integer, p_patch jsonb)
returns setof public.records
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_actor is null or p_farm_id is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'invalid update' using errcode = '22023';
  end if;
  if coalesce(p_patch->>'status', '') <> all (array['needs_info', 'pending_review']) then
    raise exception 'A reply can only leave a record waiting for details or send it for review' using errcode = '22023';
  end if;

  perform set_config('app.actor', p_actor::text, true);

  return query
    update public.records r set
      record_date = (p_patch->>'record_date')::date,
      payload = p_patch->'payload',
      status = p_patch->>'status',
      missing_fields = coalesce(array(select jsonb_array_elements_text(p_patch->'missing_fields')), '{}'::text[]),
      fingerprint = p_patch->>'fingerprint'
    where r.id = p_record_id
      and r.farm_id = p_farm_id
      and r.version = p_expected_version
      and r.created_by = p_actor
      and r.status in ('draft', 'needs_info')
      and exists (select 1 from public.farm_members m where m.user_id = p_actor and m.farm_id = p_farm_id)
    returning r.*;
end;
$$;

revoke all on function public.channel_update_record(uuid, uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.channel_update_record(uuid, uuid, uuid, integer, jsonb) to service_role;
grant select, update on public.records to service_role;
grant select on public.farm_members, public.farms to service_role;
