-- Phase 2: private bucket for the photos and PDFs the farm-records agent reads.
--
-- Files are written ONLY by the server (service role, which bypasses these policies) under
-- `<farm_id>/<capture key>/<n>.<ext>`. Farm members can read their own farm's folder; nobody
-- can write, overwrite or delete through the client API, and nothing is publicly reachable.
-- Reading is done with short-lived signed URLs.
--
-- Same fail-closed rules as the receipts bucket (migration 3):
--   1. Any client-facing policy naming 'record-files' is dropped and replaced by the one below.
--   2. Every remaining client-facing permissive policy must pin itself to one named bucket, with
--      no OR / NOT, otherwise this migration FAILS and lists it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'record-files', 'record-files', false,
  5242880, -- 5 MB per file (the app sends at most ~3 MB in total per capture)
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and (coalesce(qual, '') ~ $re$'record-files'$re$ or coalesce(with_check, '') ~ $re$'record-files'$re$)
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end;
$$;

-- Members read their own farm's folder. Compared as text so a malformed folder name can never
-- raise a cast error for someone else's query.
drop policy if exists record_files_select_member on storage.objects;
create policy record_files_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'record-files'
    and (storage.foldername(name))[1] in (select farm.id::text from public.farms farm where farm.id in (select public.my_farm_ids()))
  );

do $$
declare
  leftovers text;
  pinned constant text := $re$bucket_id\s*=\s*'[^']+'$re$;
  unsafe constant text := $re$\m(or|not)\M$re$;
begin
  select string_agg(policyname, ', ') into leftovers
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and permissive = 'PERMISSIVE'
    and roles && array['public', 'anon', 'authenticated']::name[]
    and (
      (qual is not null and not (qual ~ pinned and qual !~* unsafe))
      or (with_check is not null and not (with_check ~ pinned and with_check !~* unsafe))
    );

  if leftovers is not null then
    raise exception 'Cannot apply: storage.objects has permissive polic(ies) not pinned to a single named bucket, which would expose the record-files bucket: %. Scope each to its bucket (bucket_id = ''name'', no OR/NOT) or drop it, then re-run.', leftovers;
  end if;
end;
$$;
