-- 166: Converge `jobs` + `workflow_executions` to a clean UNIQUE constraint
-- on `(user_id, idempotency_key)` from any of the three states we ended up
-- with after the migration-165 number collision.
--
-- Background
-- ----------
-- Migration 163 created a partial unique INDEX on
--   `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
-- that PostgREST's `.upsert({...}, { onConflict: ... })` couldn't match,
-- which crashed every job-creating route with
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- in production.
--
-- Two separate PRs landed concurrently with the same migration number 165:
--   * `165_idempotency_index_non_partial.sql` (PR #2875) — replaced the
--     partial index with a non-partial unique INDEX
--   * `165_idempotency_unique_constraint.sql` (PR #2873) — replaced the
--     partial index with a non-partial UNIQUE CONSTRAINT
-- Both fix the runtime bug. But Supabase tracks migrations by a `version`
-- PRIMARY KEY on `schema_migrations`, so only ONE row with version=165
-- can ever exist. Whichever migration ran first won; the other always
-- crashed with `duplicate key value violates unique constraint
-- "schema_migrations_pkey"` and every subsequent deploy retried it.
--
-- On production: 165_idempotency_index_non_partial ran first
-- (alphabetical), recorded (version=165, name="idempotency_index_non_partial"),
-- created a non-partial unique INDEX. The other file's INSERT failed →
-- production has an INDEX, no constraint.
--
-- On staging: 165_idempotency_unique_constraint ran first (PR #2873
-- merged before PR #2875). Recorded (version=165, name="idempotency_unique_constraint"),
-- created a UNIQUE CONSTRAINT. The other file's INSERT failed → staging
-- has a CONSTRAINT, no plain index.
--
-- On any fresh environment that catches up after this PR: neither 165
-- file exists in the repo (both were deleted in the same PR as this
-- migration), so Supabase has nothing to apply at version 165 — but it
-- will run THIS migration (166) and converge to the constraint shape.
--
-- Strategy
-- --------
-- Drop both possible shapes (constraint OR plain index) with IF EXISTS
-- so we can re-add the canonical UNIQUE constraint cleanly. Dropping a
-- constraint cascades to its underlying index automatically; the
-- separate DROP INDEX IF EXISTS is for the production case where only a
-- plain index exists. Wrapping the ADD CONSTRAINT in a DO block with
-- `EXCEPTION WHEN duplicate_object` keeps this migration idempotent —
-- on a fresh DB that already has the canonical constraint (e.g. someone
-- manually fixed it), re-running this is a no-op.
--
-- Lock notes: ALTER TABLE ADD CONSTRAINT UNIQUE acquires a brief
-- AccessExclusive lock on each table while it builds the underlying
-- index. The tables are hot, but the lock window is bounded by the
-- index build time on existing rows.

BEGIN;

-- jobs
ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_idempotency_uniq;
DROP INDEX IF EXISTS public.jobs_idempotency_uniq;
DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_idempotency_uniq
    UNIQUE (user_id, idempotency_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- workflow_executions
ALTER TABLE public.workflow_executions
  DROP CONSTRAINT IF EXISTS workflow_executions_idempotency_uniq;
DROP INDEX IF EXISTS public.workflow_executions_idempotency_uniq;
DO $$ BEGIN
  ALTER TABLE public.workflow_executions
    ADD CONSTRAINT workflow_executions_idempotency_uniq
    UNIQUE (user_id, idempotency_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
