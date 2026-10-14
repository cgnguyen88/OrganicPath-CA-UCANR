-- Phase 2: durable rate limits for the AI endpoints.
--
-- The in-memory limiter only counts within one serverless instance, so a caller who lands on many
-- instances multiplies their limit. This keeps the counts in Postgres, shared by every instance.
--
-- Only the server (service role) can use it: the server verifies the caller's token first and
-- passes the verified user id as the subject, so a client can neither spoof a subject nor choose
-- its own limits. Blocked attempts are not recorded, so hammering cannot extend a lockout or grow
-- the table.

create table if not exists public.rate_limit_hits (
  id      bigint generated always as identity primary key,
  bucket  text not null check (bucket ~ '^[a-z0-9:_-]{1,60}$'),
  subject text not null check (char_length(subject) between 1 and 64),
  hit_at  timestamptz not null default now()
);

create index if not exists rate_limit_hits_lookup_idx on public.rate_limit_hits (bucket, subject, hit_at);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from public, anon, authenticated;
grant select, insert, delete on public.rate_limit_hits to service_role;

-- Take one token from (bucket, subject) if fewer than p_max were taken in the last
-- p_window_seconds. Returns whether it was allowed, and how long to wait when it was not.
create or replace function public.take_rate_token(p_bucket text, p_subject text, p_max integer, p_window_seconds integer)
returns table (allowed boolean, retry_after_sec integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  used integer;
  oldest timestamptz;
  window_start timestamptz;
begin
  if p_max is null or p_max < 1 or p_max > 1000000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  -- One caller at a time per (bucket, subject), so concurrent requests cannot both pass the check.
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || '|' || p_subject, 0));

  window_start := now() - make_interval(secs => p_window_seconds);
  select count(*), min(hit_at) into used, oldest
  from public.rate_limit_hits
  where bucket = p_bucket and subject = p_subject and hit_at > window_start;

  if used >= p_max then
    return query select false, greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => p_window_seconds) - now())))::integer);
    return;
  end if;

  insert into public.rate_limit_hits (bucket, subject) values (p_bucket, p_subject);
  -- Tidy this subject's expired hits as we go.
  delete from public.rate_limit_hits where bucket = p_bucket and subject = p_subject and hit_at <= window_start;
  -- And a few hits of people who stopped calling (bounded, so it stays cheap): no job needed.
  delete from public.rate_limit_hits where id in (select h.id from public.rate_limit_hits h where h.hit_at < now() - interval '2 days' limit 50);
  return query select true, 0;
end;
$$;

-- Housekeeping for subjects that stopped calling: run now and then (a scheduled job, or by hand).
create or replace function public.purge_rate_limit_hits()
returns bigint
language sql
security invoker
set search_path = public, pg_temp
as $$
  with removed as (delete from public.rate_limit_hits where hit_at < now() - interval '2 days' returning 1)
  select count(*) from removed
$$;

revoke all on function public.take_rate_token(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.purge_rate_limit_hits() from public, anon, authenticated;
grant execute on function public.take_rate_token(text, text, integer, integer) to service_role;
grant execute on function public.purge_rate_limit_hits() to service_role;
