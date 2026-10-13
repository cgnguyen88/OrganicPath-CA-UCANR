-- Phase 1 / bridge: keep the Receipt Manager page feeding the new records system.
--
-- The page still reads and writes `receipts`. Until it is replaced by the document import
-- (Phase 6), every new receipt is mirrored as a purchase record, and deleting a receipt
-- VOIDS its record (history is never deleted). So Purchases, "Purchases without OMRI
-- listing" and the change history stay complete whichever screen was used.
--
--   owner/manager adds a receipt -> approved purchase record
--   crew adds a receipt          -> pending_review (waits in Needs Review)

create or replace function public.receipts_mirror_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.farm_id is null then
    return null;
  end if;

  insert into public.records (farm_id, kind, status, record_date, payload, missing_fields, source, source_ref, created_by, attachments, created_at)
  values (
    new.farm_id,
    'purchase',
    case
      when cardinality(public.receipt_missing_fields(new)) > 0 then 'needs_info' -- keep it, but never as an incomplete reviewable record
      when public.has_farm_role(new.farm_id, array['owner', 'manager']) then 'approved'
      else 'pending_review'
    end,
    new.date,
    public.receipt_purchase_payload(new),
    public.receipt_missing_fields(new),
    'manual',
    'receipt:' || new.id,
    new.user_id,
    public.receipt_attachments(new),
    coalesce(new.added_at, now())
  )
  on conflict (farm_id, source_ref) where source_ref is not null do nothing;

  return null;
end;
$$;

create or replace function public.receipts_mirror_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a person deleting a receipt voids its record. A deletion with no signed-in user is
  -- the database cascading from an account deletion, and that must not rewrite the history.
  if (select auth.uid()) is null then
    return null;
  end if;

  update public.records
  set status = 'voided'
  where farm_id = old.farm_id
    and source_ref = 'receipt:' || old.id
    and status <> 'voided';
  return null;
end;
$$;

drop trigger if exists receipts_mirror_insert on public.receipts;
create trigger receipts_mirror_insert
  after insert on public.receipts
  for each row execute function public.receipts_mirror_insert();

drop trigger if exists receipts_mirror_delete on public.receipts;
create trigger receipts_mirror_delete
  after delete on public.receipts
  for each row execute function public.receipts_mirror_delete();

revoke all on function public.receipts_mirror_insert() from public, anon, authenticated;
revoke all on function public.receipts_mirror_delete() from public, anon, authenticated;
