-- 693 — the index of a plugin's engine children whose credits are still held,
-- alone in its own file (379's, 519's, 569's and 662's reasoning: a plain
-- CREATE INDEX reads the whole heap once; alone here the build takes SHARE on
-- jobs — writes wait for it, reads do not. Apply off-peak).
--
-- A child job a private plugin asked to keep HELD after it completes records
-- its settlement in `held_completion_fields.deferredSettlement`, with
-- `open: true` until its usage log is confirmed committed or refunded
-- (backend/src/lib/deferred-child-settlement.ts). The sweep every 5 minutes
-- and every job / workflow / project delete read
--   WHERE (held_completion_fields -> 'deferredSettlement' ->> 'open') = 'true'
-- to settle or release the ones still held. Partial on exactly those rows, so
-- the index holds only the children whose money is still open — a handful at
-- any time, never a history — and the read needs no look-back window.
--
-- What the build reads: every row's `held_completion_fields`, which is NULL on
-- all but the rows held for review (and these children), so the predicate
-- costs no de-TOAST; the build is one pass over the heap, like 662's.
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_jobs_deferred_child_settlement_open
  ON public.jobs (completed_at)
  WHERE ((held_completion_fields -> 'deferredSettlement') ->> 'open') = 'true';
