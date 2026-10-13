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

## Known gaps (planned)

* No invite/accept flow yet, so a farm has exactly one member (its owner). Until it exists, "the user's farm" is their oldest membership; add an explicit `active_farm_id` with invites.
* An owner can be the last member removed, leaving an ownerless farm.
* Receipts cannot be edited (no UPDATE policy); revision history arrives with the records model.
* Storage paths are `<user_id>/…`; they move to `<farm_id>/…` when teams ship.
* The Receipt Manager page and its `receipts` table remain as an input channel (bridged into records). They are replaced by document import in a later phase.
* Records have no attachment upload UI yet (the `attachments` column is ready for the agent and the import).
