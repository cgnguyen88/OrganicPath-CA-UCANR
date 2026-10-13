-- Run this in the Supabase SQL editor BEFORE applying the Phase 0 migrations.
-- Migration 2 and 3 drop and replace every policy listed under "will be replaced".

-- 1) Policies that will be REPLACED
select schemaname, tablename, policyname, permissive, roles, cmd, qual as using_clause, with_check
from pg_policies
where (schemaname = 'public' and tablename in ('profiles', 'receipts'))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;

-- 2) Is RLS currently on?
select n.nspname as schema, c.relname as table, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (('public','profiles'), ('public','receipts'), ('storage','objects'));

-- 3) Is the receipts bucket public? (it must not be)
select id, public from storage.buckets where id = 'receipts';

-- 4) Existing triggers on auth.users (the new one is on_auth_user_created_provision_farm)
select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- 5) Columns on the two legacy tables (the migration assumes id/user_id exist)
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in ('profiles', 'receipts')
order by table_name, ordinal_position;
