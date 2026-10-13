-- Phase 0 / baseline: the two tables the app already depends on.
--
-- These were created by hand in the original Supabase project and never captured in
-- this repo. On a brand-new project they do not exist, so later migrations would fail.
-- This file creates them if missing and adds any missing columns if they exist, so it is a
-- no-op on a project that already has them. Policies and privileges are set in migration 2.
-- Columns mirror what src/lib/db.js and the components read and write.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade
);

alter table public.profiles add column if not exists operation_data   jsonb;
alter table public.profiles add column if not exists compliance_state jsonb;
alter table public.profiles add column if not exists wizard_progress  jsonb;
alter table public.profiles add column if not exists occsp_state      jsonb;
alter table public.profiles add column if not exists state_reg_type   text;
alter table public.profiles add column if not exists state_reg_state  jsonb;
alter table public.profiles add column if not exists updated_at       timestamptz default now();

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid()
);

alter table public.receipts add column if not exists user_id        uuid references auth.users (id) on delete set null;
alter table public.receipts add column if not exists date           date;
alter table public.receipts add column if not exists supplier       text;
alter table public.receipts add column if not exists product        text;
alter table public.receipts add column if not exists category       text;
alter table public.receipts add column if not exists omri_listed    text;
alter table public.receipts add column if not exists quantity       numeric;
alter table public.receipts add column if not exists unit           text;
alter table public.receipts add column if not exists total_cost     numeric;
alter table public.receipts add column if not exists invoice_number text;
alter table public.receipts add column if not exists notes          text;
alter table public.receipts add column if not exists file_name      text;
alter table public.receipts add column if not exists file_url       text;
alter table public.receipts add column if not exists added_at       timestamptz default now();
