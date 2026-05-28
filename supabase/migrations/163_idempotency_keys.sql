-- 163: Race-proof idempotency keys for jobs + workflow_executions.
--
-- Background: the prior `input_fingerprint` dedup (migration 144) is best-
-- effort — the preHandler SELECTs for a recent match BEFORE the INSERT, and
-- the fingerprint column is backfilled in a follow-up UPDATE. Two concurrent
-- POSTs within ~50ms (double-click, React StrictMode dev mode, network
-- retry) both pass the SELECT, both INSERT, both backfill. One generation
-- intent → multiple jobs in the user's Executions tab. The DB has the
-- column but no enforcement.
--
-- This migration adds an `idempotency_key` column to both tables with a
-- partial UNIQUE constraint. The new helper in `lib/idempotent-insert.ts`
-- issues INSERT ... ON CONFLICT (user_id, idempotency_key) DO NOTHING. The
-- losing caller of a race observes an empty result and SELECTs the winner's
-- row by (user_id, key). After this migration the race is closed at the
-- database level — no application code can bypass it.
--
-- The partial predicate (`WHERE idempotency_key IS NOT NULL`) keeps the
-- index tight: every row from before this rollout has NULL keys and is
-- excluded. Existing INSERTs that don't supply a key continue to work
-- unchanged.
--
-- Lifecycle: idempotency keys are client-supplied (Idempotency-Key header
-- or server-computed fingerprint as fallback). They do NOT expire — once
-- set, the key uniquely identifies the row forever. To avoid unbounded
-- growth in the unique index for old rows that no longer need dedup
-- protection, see migration 164 for a TTL-based cleanup of rows older
-- than the dedup window. The index itself stays tight because the column
-- can be nulled out post-window.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_uniq
  ON public.jobs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_executions_idempotency_uniq
  ON public.workflow_executions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
