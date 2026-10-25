-- 562 — the Trash's jobs index, alone in its own file (379's header: a plain
-- CREATE INDEX reads the whole heap once, and inside 561 it would do so while
-- the ADD COLUMN held ACCESS EXCLUSIVE on jobs, blocking every read). Alone
-- here the build takes SHARE on jobs: writes wait for it, reads do not.
--
-- Partial on the jobs in the Trash, so it stays as small as the Trash. It
-- serves the Trash listing (`list_trash`: one owner's deleted jobs, newest
-- first) and the 30-day purge (`deleted_at` older than the cutoff, a scan of
-- this small index). The live-job reads filter `deleted_at IS NULL`, which
-- every job but the trashed ones passes: no index helps them.
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_jobs_trash
  ON public.jobs (user_id, deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;
