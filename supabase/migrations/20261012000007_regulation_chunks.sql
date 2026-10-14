-- Phase 2: grounding store for the assistant's "check this material against 7 CFR 205" answers.
--
-- Holds passages of the U.S. organic regulations (7 CFR Part 205, from the eCFR), one row per
-- paragraph-sized chunk so an answer can cite the exact paragraph. The table is EMPTY until the
-- ingest script loads it (the service role, outside the client API). Signed-in users can read
-- and search it; nobody can write it through the client API. It holds public law, not farm data,
-- so it is shared across farms.
--
-- Search is Postgres full-text (websearch syntax, so model- or user-supplied text can never
-- break the query) with a rank, returning the citation and anchor for every hit.

create table if not exists public.regulation_chunks (
  id           bigint generated always as identity primary key,
  title_number smallint not null default 7,
  part         text not null,
  section      text not null,   -- '205.601'
  anchor       text not null,   -- '205.601(a)(1)' (the paragraph this chunk starts at)
  citation     text not null,   -- '7 CFR 205.601(a)(1)'
  heading      text not null,
  body         text not null,
  ord          integer not null,
  source_url   text,
  version_date date not null,   -- the eCFR "as of" date this text was taken from
  tsv          tsvector generated always as (
                 setweight(to_tsvector('english', coalesce(heading, '')), 'A')
                 || setweight(to_tsvector('english', coalesce(body, '')), 'B')
               ) stored,
  created_at   timestamptz not null default now(),
  constraint regulation_chunks_body_size check (char_length(body) between 1 and 8000),
  constraint regulation_chunks_unique unique (citation, version_date)
);

create index if not exists regulation_chunks_tsv_idx on public.regulation_chunks using gin (tsv);
create index if not exists regulation_chunks_section_idx on public.regulation_chunks (section, ord);

alter table public.regulation_chunks enable row level security;

drop policy if exists regulation_chunks_select_authenticated on public.regulation_chunks;
create policy regulation_chunks_select_authenticated on public.regulation_chunks
  for select to authenticated using (true);

revoke all on public.regulation_chunks from public, anon, authenticated;
grant select on public.regulation_chunks to authenticated;

-- Ranked passages for a query, with citations. SECURITY INVOKER, so the table's policy applies.
-- First tries every word (websearch syntax); if nothing matches, falls back to any word, ranked so
-- that passages matching more of the words come first. Natural-language questions then still find
-- something, while precise queries are never diluted.
create or replace function public.search_regulations(search_query text, max_results integer default 6)
returns table (citation text, anchor text, heading text, body text, source_url text, version_date date, rank real)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(search_query, '')) as strict_q,
           replace(plainto_tsquery('english', coalesce(search_query, ''))::text, ' & ', ' | ')::tsquery as loose_q
  ),
  strict_hits as (
    select c.id, ts_rank_cd(c.tsv, q.strict_q) as rank
    from public.regulation_chunks c, q
    where c.tsv @@ q.strict_q
  ),
  chosen as (
    select id, rank from strict_hits
    union all
    select c.id, ts_rank_cd(c.tsv, q.loose_q) as rank
    from public.regulation_chunks c, q
    where c.tsv @@ q.loose_q
      and not exists (select 1 from strict_hits)
  )
  select c.citation, c.anchor, c.heading, c.body, c.source_url, c.version_date, chosen.rank::real
  from chosen
  join public.regulation_chunks c on c.id = chosen.id
  order by chosen.rank desc, c.section, c.ord
  limit least(greatest(coalesce(max_results, 6), 1), 20)
$$;

revoke all on function public.search_regulations(text, integer) from public, anon;
grant execute on function public.search_regulations(text, integer) to authenticated;
