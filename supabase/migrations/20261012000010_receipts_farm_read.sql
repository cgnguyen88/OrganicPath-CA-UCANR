-- Receipt photos: let the people on a farm open the photos of that farm's receipts.
--
-- Receipts from the old Receipt Manager are filed under the uploader's user id (`<user_id>/<file>`) and,
-- until now, only that person could open them. But every receipt was also made into a purchase record
-- (migration 5), and a farm's records are visible to everyone on the farm. So an owner looking at a purchase
-- their crew entered could see the record but not the photo it came from.
--
-- This adds ONE read policy: a member may open a file that belongs to a receipt of their own farm (the receipt
-- row names the file in `file_path` and the farm in `farm_id`, and the file is in its author's own folder). It goes by the receipt, not by who uploaded the
-- file, so a person who belongs to two farms never shares a photo with the wrong one. Nothing else changes:
-- uploads and deletes stay limited to your own folder, files of other buckets are not touched, files that no
-- receipt row names stay private to their uploader, and signed-out visitors and people in no farm still see only
-- their own folder.
--
-- It follows the rules of migration 3: it names one bucket (`bucket_id = 'receipts'`) and uses no OR / NOT, so
-- the "every policy must pin to one bucket" check of the later migrations still accepts it.
--
-- Note: migration 3 drops every policy that mentions the receipts bucket when it is run. If it is ever run
-- again, run this one again afterwards.

create index if not exists receipts_file_path_idx on public.receipts (file_path);

drop policy if exists receipts_objects_select_farm on storage.objects;
create policy receipts_objects_select_farm on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and exists (
      select 1
      from public.receipts r
      where r.file_path = storage.objects.name
        and r.farm_id in (select public.my_farm_ids())
        -- A receipt's `file_path` is typed by whoever adds the receipt, so it only counts for a file in the folder
        -- of the receipt's own author: nobody can claim another person's photo by writing its path on a receipt.
        and (storage.foldername(storage.objects.name))[1] = r.user_id::text
    )
  );
