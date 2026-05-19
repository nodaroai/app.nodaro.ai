-- Migration 136 — One-time backfill of `provider_call_started_at` for pre-Phase-1 stuck rows
--
-- The Phase 2 reconciliation cron (`backend/src/lib/reconcile/cron.ts`) only
-- finds rows where `provider_call_started_at IS NOT NULL` (the inflight index
-- predicate is `WHERE status IN ('pending','processing')`, but the SELECT
-- additionally filters out null call-start times because they cannot be aged
-- against a threshold).
--
-- Pre-Phase-1 rows that were already stuck at the moment Phase 1 shipped have
-- `provider_call_started_at = NULL` because the persistence helpers (`onTaskCreated`
-- + `markProviderCallStart`) added in Phase 1 only fire on NEW rows. Without
-- this backfill they would remain invisible to the sweep forever and continue
-- to leak reserved credits.
--
-- Bounded by `created_at < now() - interval '1 hour'` so we only touch rows
-- that are demonstrably stuck (more than 1 hour past creation with no
-- terminal-state UPDATE). Job 88681ab8-a5b9-4bf1-80ea-0bd64813b363 and similar
-- rows from before this fix shipped will be swept by the next cron tick.
--
-- Idempotent: filters on `provider_call_started_at IS NULL` so re-running the
-- migration (or running it after some rows have already been backfilled) is a
-- no-op for those rows.

UPDATE public.jobs
   SET provider_call_started_at = COALESCE(started_at, created_at)
 WHERE status IN ('pending', 'processing')
   AND provider_call_started_at IS NULL
   AND created_at < now() - interval '1 hour';
