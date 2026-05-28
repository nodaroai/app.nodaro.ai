-- 165: Fix idempotency upserts by dropping the partial-index predicate.
--
-- Migration 163 created a partial UNIQUE index on
--   `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
-- so the index would only cover rows that actually carry a dedup key. The
-- intent is correct, but the helper in `lib/idempotent-insert.ts` issues
-- an upsert through Supabase JS:
--   .upsert(payload, { onConflict: "user_id,idempotency_key",
--                       ignoreDuplicates: true })
-- PostgREST translates that to
--   INSERT INTO jobs (...) ... ON CONFLICT (user_id, idempotency_key)
--   DO NOTHING
-- with NO `WHERE idempotency_key IS NOT NULL` predicate. Postgres requires
-- the ON CONFLICT inference target to match an existing unique constraint
-- exactly, and a partial index without the matching WHERE in the statement
-- does NOT match. Every call to `insertWithIdempotencyKey` with a non-null
-- key crashed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- which blocked every job-creating route in production.
--
-- Fix: drop the partial predicate so the unique index covers the whole
-- table. Postgres treats NULLs as distinct in btree unique indexes by
-- default (no `NULLS NOT DISTINCT`), so multiple rows with NULL
-- `idempotency_key` per user are still allowed — same effective behavior
-- as the partial predicate, just with a slightly larger index. The
-- conflict path now matches against the full index and works through
-- PostgREST.
--
-- Risk: index size grows by the number of rows with NULL idempotency_key,
-- but NULL btree entries are small and the column was just added (most
-- legacy rows have NULL there until they're updated through the new
-- helper). Acceptable trade-off for correctness.

DROP INDEX IF EXISTS public.jobs_idempotency_uniq;
CREATE UNIQUE INDEX jobs_idempotency_uniq
  ON public.jobs (user_id, idempotency_key);

DROP INDEX IF EXISTS public.workflow_executions_idempotency_uniq;
CREATE UNIQUE INDEX workflow_executions_idempotency_uniq
  ON public.workflow_executions (user_id, idempotency_key);
