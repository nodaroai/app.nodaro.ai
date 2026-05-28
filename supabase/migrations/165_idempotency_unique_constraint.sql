-- 165: Replace partial unique INDEXes from 163 with non-partial UNIQUE
-- CONSTRAINTs so `ON CONFLICT (user_id, idempotency_key)` can match.
--
-- Why this exists:
-- Migration 163 created partial unique indexes:
--     CREATE UNIQUE INDEX jobs_idempotency_uniq
--       ON jobs (user_id, idempotency_key)
--       WHERE idempotency_key IS NOT NULL;
-- These enforce uniqueness correctly, but PostgreSQL's `ON CONFLICT (cols)`
-- inference does NOT match a partial index unless the same WHERE predicate
-- is repeated in the ON CONFLICT clause. Supabase's `.upsert(payload,
-- { onConflict: "user_id,idempotency_key" })` does not expose a way to add
-- that predicate. Result: every call through `insertWithIdempotencyKey`
-- (generate-image, generate-video, text-to-video, workflow-execution, and
-- 8 other call sites) fails at the DB layer with Postgres error 42P10:
-- `there is no unique or exclusion constraint matching the ON CONFLICT
-- specification`. The user-facing impact is a hard 500 on every POST that
-- creates a job — production-blocking.
--
-- The fix: drop the partial unique indexes and add non-partial UNIQUE
-- constraints on the same column pair. PostgreSQL's default behavior is
-- `NULLS DISTINCT` — multiple rows with the same user_id and a NULL
-- idempotency_key are still allowed (NULL != NULL), so existing rows
-- created before #2850 remain valid and pre-#2850 INSERTs that pass
-- `idempotencyKey: null` continue to work. The unique-enforcement story
-- is identical to the partial-index version; only the storage shape
-- differs (one index entry per row instead of only non-NULL rows).
--
-- Lock notes: ALTER TABLE ADD CONSTRAINT UNIQUE acquires a brief
-- AccessExclusive lock on each table while it builds the underlying index.
-- These tables are hot, but the lock window is bounded by the index build
-- time on existing rows and the migration runs during the standard PR
-- deploy window. The DROP INDEX before is metadata-only and instant.

BEGIN;

DROP INDEX IF EXISTS public.jobs_idempotency_uniq;
DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_idempotency_uniq
    UNIQUE (user_id, idempotency_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS public.workflow_executions_idempotency_uniq;
DO $$ BEGIN
  ALTER TABLE public.workflow_executions
    ADD CONSTRAINT workflow_executions_idempotency_uniq
    UNIQUE (user_id, idempotency_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
