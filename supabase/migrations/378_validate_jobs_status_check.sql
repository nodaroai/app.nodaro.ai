-- 378 — validate the widened jobs.status CHECK. Split from 377 on purpose:
-- VALIDATE takes only SHARE UPDATE EXCLUSIVE and scans the table, so it does not
-- hold 377's ACCESS EXCLUSIVE lock through the scan. (334 does both in one file;
-- jobs is far larger than the rows 334 touched.)
--
-- Safe to run against a database where 377's constraint is already valid:
-- VALIDATE CONSTRAINT on an already-validated constraint is a no-op.
ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_status_check;
