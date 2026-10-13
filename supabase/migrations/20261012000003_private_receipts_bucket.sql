-- Phase 0 / 3 of 3: private receipts bucket.
--
-- Forces the bucket private, caps what can be uploaded, and replaces its object
-- policies. Files are only reachable through short-lived signed URLs minted for
-- the owner's own folder. The upload path layout is `<user_id>/<file>`; Phase 1
-- moves it to `<farm_id>/<file>` so crew can share a farm's documents.
--
-- REVIEW BEFORE APPLYING. Two rules, both fail-closed:
--   1. Any client-facing policy on storage.objects that names the receipts bucket
--      (`'receipts'` anywhere in its text, in any form: =, IN, ANY(ARRAY[...])) is
--      dropped and replaced by the three policies below.
--   2. After that, every remaining client-facing policy must PIN itself to exactly one
--      named bucket (`bucket_id = '<name>'`) with no OR / NOT. Anything else could reach
--      the receipts bucket (permissive policies are OR-ed), so the migration FAILS and
--      lists it. Review the policy, scope it to its bucket (or drop it), then re-run.
--      This can reject harmless policies (e.g. ones built on helper functions). That is
--      deliberate: we never try to prove a policy is safe by pattern-matching what it
--      looks like. A default Supabase project has no policies on storage.objects.
--
-- This also REPLACES any size/type limits already configured on the receipts bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false,
  10485760, -- 10 MB per file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Drop every client-facing policy that names the receipts bucket in ANY form.
-- ('receipts-archive' is a different literal and is left alone.)
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and (coalesce(qual, '') ~ $re$'receipts'$re$ or coalesce(with_check, '') ~ $re$'receipts'$re$)
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end;
$$;

drop policy if exists receipts_objects_select_own on storage.objects;
create policy receipts_objects_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists receipts_objects_insert_own on storage.objects;
create policy receipts_objects_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists receipts_objects_delete_own on storage.objects;
create policy receipts_objects_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Rule 2: every remaining client-facing policy must pin to ONE named bucket, with no OR / NOT.
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
    raise exception 'Cannot apply: storage.objects has permissive polic(ies) not pinned to a single named bucket, which would expose the receipts bucket: %. Scope each to its bucket (bucket_id = ''name'', no OR/NOT) or drop it, then re-run.', leftovers;
  end if;
end;
$$;
