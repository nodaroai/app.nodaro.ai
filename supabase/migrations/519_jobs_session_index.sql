-- 519 — jobs.session_id's index, alone in its own file (see 379's header: a
-- plain CREATE INDEX reads the whole heap once, and inside 518 it would do so
-- while the ADD COLUMN held ACCESS EXCLUSIVE on jobs, blocking every read).
-- Alone here the build takes SHARE on jobs: writes wait for it, reads do not.
--
-- Needed by the FK's ON DELETE SET NULL: deleting a session clears
-- jobs.session_id on the jobs born in it, and without this index each session
-- delete would scan the whole jobs table.
CREATE INDEX IF NOT EXISTS idx_jobs_session_id
  ON public.jobs (session_id) WHERE session_id IS NOT NULL;
