-- Relay provenance, the DURABLE half (Track B / spec
-- 2026-09-04-sai-local-development §9.3 (D18), invariants 9 and 10a).
--
-- `jobs.relay_job_id` (the previous migration) says "this instance did not
-- create the bytes behind this row". Every delete path reads it — and on the
-- asset side it is unreadable exactly when it is needed most:
--
--   `assets.job_id` is `REFERENCES public.jobs(id) ON DELETE SET NULL`
--   (001_initial_schema.sql). Deleting a job from history therefore NULLs the
--   link on the SURVIVING library row, and the marker dies with the job row.
--   The library item is still listed and still permanently deletable, so the
--   near end would then delete an object the far end's job row still points at
--   — the exact loss §9.3 exists to prevent — and refund quota bytes the
--   shared-bucket passthrough never charged.
--
-- So the marker is stamped onto the ASSET at creation, where nothing cascades
-- it away: `createAssetFromJob` (workers/shared.ts) copies the job's
-- `relay_job_id` whenever the derived key is NOT in the near job's own key
-- family. The far end's key stem IS its job id, so the column doubles as
-- support provenance: the near row names the far job that owns the object.
--
-- Deliberately the far id and not a boolean: a boolean says "foreign", this
-- says WHOSE, and it is the same column name and meaning as on `jobs`.
--
-- NULL on every non-relayed row, in every edition. No backfill: an object
-- created before this column existed was, by definition, created by this
-- instance — the passthrough that makes foreign objects reachable ships in the
-- same unreleased branch as the column.
alter table public.assets
  add column if not exists relay_job_id text;

comment on column public.assets.relay_job_id is
  'Far-end job id when the object behind this asset was created by a connected Nodaro cloud, not by this instance. Non-null ⇒ drop the row, never the bytes, and never move the quota. Survives the ON DELETE SET NULL of assets.job_id, which is the whole point.';

-- TRUST, stated rather than assumed. `public.assets` carries TABLE-level
-- grants (no column-level narrowing like migration 347's on `jobs`) and an RLS
-- UPDATE policy on `user_id = auth.uid()`, so an authenticated owner can write
-- this column on their own row the same way they can already write `r2_key` and
-- `size_bytes`. That buys them nothing they did not already have, and it fails
-- in the safe direction: the marker can only ever make this instance KEEP bytes
-- and SKIP a quota refund — never delete another tenant's object, never move
-- money. (Setting `r2_key` to NULL already skips the object delete outright.)
-- The column is deliberately NOT corroborated against the key stem at delete
-- time: a far-end key shape we did not foresee would then be deleted, and
-- deleting the far end's bytes is the irreversible failure this whole rule
-- exists to prevent, while keeping bytes is a storage bill.
--
-- The delete paths that hold KEYS rather than a job (locations / objects /
-- creatures permanent delete, workflow-delete's workflow and project scopes)
-- ask `r2_key = any(...) and relay_job_id is not null`. The partial index makes
-- that an index scan over relayed rows only — and it is EMPTY on every
-- deployment that never relays, which is what keeps the extra read free.
create index if not exists idx_assets_relay_job_id
  on public.assets (r2_key) where relay_job_id is not null;
