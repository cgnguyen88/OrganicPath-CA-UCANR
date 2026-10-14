# Database migrations

Apply in filename order. They are idempotent (safe to re-run) and are covered by
`npm test` (they run against a real Postgres via PGlite with stand-ins for Supabase's
`auth` and `storage` schemas).

| File | What it does |
|---|---|
| `20261012000000_legacy_baseline.sql` | Creates `profiles` and `receipts` if they don't exist (a brand-new project) and adds any missing columns. A no-op on a project that already has them. |
| `20261012000001_farm_tenancy.sql` | `farms`, `farm_members`, sign-up provisioning trigger, backfill, RLS. Membership is server-written only. |
| `20261012000002_profiles_receipts_rls.sql` | RLS on `profiles` and `receipts`, `receipts.farm_id` / `file_path`. **Drops every existing policy on those tables.** |
| `20261012000003_private_receipts_bucket.sql` | Private `receipts` bucket (10 MB, images/PDF only) and its object policies. **Fails on purpose** if another storage policy could expose the bucket. |
| `20261012000004_records.sql` | **Phase 1.** `records` (nine kinds, review workflow), the immutable `record_revisions` history, and `saved_views` with the four default pinned views. Crew submit, owners/managers approve, nothing is ever deleted (records are voided). Also imports existing receipts as approved purchase records. |
| `20261012000005_receipts_bridge.sql` | Keeps the Receipt Manager page feeding the new system: a new receipt becomes a purchase record (approved for owners/managers, "needs review" for crew); deleting a receipt voids its record. |
| `20261012000006_record_files_bucket.sql` | **Phase 2.** Private `record-files` bucket (5 MB, images/PDF) for photos the agent reads. Written only by the server; farm members can read their own farm's folder via signed URLs; clients cannot upload, overwrite or delete. Same fail-closed storage-policy rules as migration 3. |
| `20261012000007_regulation_chunks.sql` | **Phase 2.** `regulation_chunks` (7 CFR Part 205, paragraph-sized, with citations) and `search_regulations()` full-text search (all words first, any word as a fallback). Empty until `npm run ingest:regulations -- --file part205.xml --date YYYY-MM-DD --load` is run with the service-role key. Signed-in users can read it; nobody can write it through the client API. |
| `20261012000008_rate_limits.sql` | **Phase 2.** `rate_limit_hits` and `take_rate_token()`: rate limits shared by every serverless instance (per user, plus a global daily cap), usable only by the server role. Without it, or if the database is unreachable, limits fall back to per-instance counting. `purge_rate_limit_hits()` clears old rows; run it now and then. |
| `20261012000009_channels.sql` | **Phase 3.** Chat channels (Telegram): one-time link codes (`create_channel_link_code`, only a hash is stored) redeemed into a *pending* link that the Telegram user must confirm after seeing the farm name and a masked owner email; linked accounts (`channel_identities`; a connected chat can never be taken over); handled-update ids (retries run once); message-to-record links; and `channel_update_record` (lets a reply fill the author's own open record, checked against author, farm, membership, status and version in SQL, with the history naming them). The tables clear their own old rows. Server-only except making a link code and unlinking your own account. Also makes the record history name the actor for changes made on someone's behalf (`app.actor`). |
| `20261012000010_receipts_farm_read.sql` | Lets the people on a farm open the photos of that farm's receipts: one read policy on the `receipts` bucket, pinned to that bucket (no OR/NOT), that goes by the receipt row's `file_path` and `farm_id`, so a person in two farms never shares a photo with the wrong one. Uploads and deletes stay limited to your own folder, and a file no receipt names stays private to its uploader. If migration 3 is ever re-run it drops this policy: run this one again afterwards. |
| `20261012000011_fields.sql` | **Fields.** The named places a farm grows things. Names are stored tidied and are unique per farm ignoring capital letters, spacing of any kind and invisible characters (`field_key()`, the same comparison the app makes), at most 500 per farm. **While any record uses a field (any status) its name cannot change and it cannot be deleted** (archive instead), enforced in the database. Owners/managers write, every member reads. Registers the field names found in each farm's *approved* records, once. |

## Before applying to a real project

1. Use a **staging** Supabase project first (or a branch), not production.
2. Run `supabase/verify/list_policies.sql` and read the output. Anything listed under
   `public.profiles`, `public.receipts` or `storage.objects` will be replaced or may block
   migration 3. If you rely on one of those policies, say so before applying.
3. On a brand-new project there is nothing to review in `profiles`/`receipts`: the baseline creates
   them. On an existing project the verify script prints their columns; the baseline only adds missing ones.
4. Back up (Supabase dashboard → Database → Backups). The migrations do not delete data,
   but they do change who can read it.
5. Migration 2 stops with an error if any receipt cannot be assigned to a farm. Fix or remove
   those rows, then re-run. Apply the files in a transaction (`supabase db push` does) so a
   failed run leaves nothing half-applied.
6. Migration 3 stops if any client-facing policy on `storage.objects` is not pinned to a single
   named bucket (no `OR`/`NOT`). That can reject a harmless policy built on a helper function:
   scope it to its bucket or drop it, then re-run. Policies that name the receipts bucket are
   replaced. Migration 3 also overwrites any size/type limits already set on that bucket.

## After applying

* New sign-ups get a farm automatically (the registration form collects the farm name).
  Existing accounts got one in the backfill; the app also calls `ensure_my_farm()` after sign-in.
* Receipt files are private. `getReceiptFileUrl()` in `src/lib/db.js` mints 5-minute links.
  Legacy rows keep their old `file_url`; those signed links expire on their own.

## Phase 1: how records work

* **Roles.** `owner`/`manager` can approve, reject, void and edit anything; `crew` can submit records and edit their own until they are reviewed.
* **History.** Every create/edit/status change writes an immutable row to `record_revisions`; no client can change or delete it.
* **No deletes.** Wrong or withdrawn records are *voided* (final). Approved records can still be corrected by an owner/manager, and the correction is logged.
* **Incomplete records** can be drafts or "needs info" but cannot enter review or approval (enforced in the database).
* **Saved views** are stored as a small declarative filter (never SQL) and validated before they run.

## Fields and stock

* **Fields** (`fields` table, migration 11). Records still keep a field as plain text (`payload.field`); the registry gives each farm one list of names to pick from. The match is by name, ignoring capital letters, so there is no foreign key to break: while any record uses a name, the database refuses to rename or delete that field (archive it instead). Fields are registered in the app (Farm Records → Fields), and the names records already use can be added in one click. The Claude capture agent is told the farm's active field names (as data in the user message, never in a system prompt) so it spells a field the way the farm does; if the list cannot be read the capture goes on without it.
* **Stock** needs no table: an `inventory` record is a dated count, so the stock now is each item's latest approved count. `reorder_level` and `omri_status` are ordinary fields of an inventory record and carry forward to later counts that do not repeat them.

## Known gaps (planned)

* No invite/accept flow yet, so a farm has exactly one member (its owner). Until it exists, "the user's farm" is their oldest membership; add an explicit `active_farm_id` with invites.
* An owner can be the last member removed, leaving an ownerless farm.
* Receipts cannot be edited (no UPDATE policy); revision history arrives with the records model.
* Storage paths are `<user_id>/…`; they move to `<farm_id>/…` when teams ship.
* The Receipt Manager page has been retired: purchases are added in **Purchases** (by hand, or from a photo through the capture panel). The `receipts` table, its bridge triggers (migration 5) and the `receipts` bucket stay, so old receipts and their photos remain in the farm's records and can still be opened; the app no longer writes new receipts.
* Records have no attachment upload UI yet (the `attachments` column is ready for the agent and the import).
