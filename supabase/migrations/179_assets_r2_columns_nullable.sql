-- assets.r2_key / r2_url: drop NOT NULL.
--
-- The R2 media-cleanup cron (ee/billing/cleanup-service.ts) "tombstones" an
-- asset whose media has been reaped by setting r2_key = NULL, r2_url = NULL
-- (keeping the row + accounting). But both columns were created NOT NULL in
-- migration 001 and never altered, so every cleanup UPDATE was rejected
-- (Postgres 23502) — silently, because the error was unchecked. The R2 object
-- was already deleted, leaving the DB row pointing at a now-404 URL (dangling
-- ref), and the cleanup loop re-selected the same WHERE r2_key IS NOT NULL rows
-- forever (potential infinite loop + negative storage accounting) for any
-- free/canceled user with >= one batch of expired assets.
--
-- Make the columns nullable so the tombstone model the code already implements
-- is valid: a cleaned asset has NULL media; the loop's `r2_key IS NOT NULL`
-- filter then correctly excludes it and the loop progresses. New asset INSERTs
-- always supply both columns, so nothing else is affected. Idempotent.

ALTER TABLE public.assets ALTER COLUMN r2_key DROP NOT NULL;
ALTER TABLE public.assets ALTER COLUMN r2_url DROP NOT NULL;
