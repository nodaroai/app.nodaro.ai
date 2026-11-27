-- 730 — the index background clip assembly claims by, alone in its own file
-- (see 519's header: a plain CREATE INDEX reads the whole heap once, and
-- inside 723 it would do so while that file's ADD COLUMN held ACCESS
-- EXCLUSIVE on jobs, blocking every read). Alone here the build takes SHARE
-- on jobs: writes wait for it, reads do not. Partial on rows waiting for an
-- assembly, of which there are none when it is built.
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS jobs_video_assembly_due_idx ON public.jobs
  ((video_assembly_recovery->>'env'), ((video_assembly_recovery->>'due')::bigint))
  WHERE video_assembly_recovery->>'state' IN ('pending','leased');
