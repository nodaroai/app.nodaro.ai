-- 496_storage_delete_retries.sql
--
-- Files a storage delete failed to remove, kept for a later retry (decided
-- 2026-10-08, storage expiry rounds 11 and 12).
--
-- Every path that deletes our storage objects — the retention reapers, the
-- user and admin permanent deletes, the community lifecycle, a worker's own
-- cleanup — goes on as if its delete had worked: the row is gone or marked,
-- so nothing would ever try that file again. Each path now deletes through
-- one funnel (backend/src/lib/storage-delete.ts) that records the file storage
-- did not confirm gone here instead, and a daily pass on every edition
-- (backend/src/lib/storage-delete-retries.ts) retries it at most 5 times, then
-- stamps `gave_up_at` and logs it. A finished retry drops the row. A pass
-- claims the rows it works (`last_attempt_at`, set before it deletes), so
-- passes on several replicas never work the same row.
--
-- Owner-agnostic: a row names a storage key, the url that links it (null when
-- none is known), the path that recorded it (`source`, a lower-case slug; the
-- backend's DeleteSource union is the list, so a new path needs no migration)
-- and, for a job's file, that job — no user. `job_id` is provenance only and
-- carries no foreign key: the file outlives a deleted job row, and the retry
-- still owes it a delete. Before it deletes, the retry asks the guards again:
-- a library row naming the key, or a relay target that made it, keeps the
-- file, and for a failed asset delete so does a job made since the failure
-- that links it.
--
-- Every edition: community installs get the table with the rest of the
-- migrations, and the retry pass needs nothing edition-gated.
--
-- Service role only: RLS on with no policies, and no grants to the client
-- roles. Nothing outside the backend reads or writes it.

CREATE TABLE IF NOT EXISTS public.storage_delete_retries (
  r2_key          text PRIMARY KEY,
  url             text,
  source          text NOT NULL CHECK (source ~ '^[a-z][a-z0-9-]{0,39}$'),
  job_id          uuid,
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- When the LATEST failed delete of this key began (taken before the delete
  -- call). A later failure at the same key moves it and keeps the attempts,
  -- `last_attempt_at`, `last_error` and `gave_up_at` (decided 2026-10-09): a
  -- key recorded again and again still gives up after 5, and a given-up key
  -- stays given up. The retry keeps an object storage last wrote at or after
  -- it (to the second): that is a new object at a reused key.
  failed_at       timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  gave_up_at      timestamptz
);

-- The retry pass reads the rows not given up, oldest first.
CREATE INDEX IF NOT EXISTS idx_storage_delete_retries_pending
  ON public.storage_delete_retries (created_at)
  WHERE gave_up_at IS NULL;

ALTER TABLE public.storage_delete_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_delete_retries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_delete_retries TO service_role;
