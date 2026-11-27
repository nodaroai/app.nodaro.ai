-- 738 — the index the daily account check of the alternate route reads
-- (ee/billing/video-route-account.ts `unroutedRouteJobsBetween`), alone in its
-- own file (379's, 519's, 569's and 662's reasoning: each migration file runs in
-- one transaction, so a plain CREATE INDEX beside another would hold SHARE on
-- jobs across both full reads; alone here the build takes SHARE on jobs once —
-- writes wait for it, reads do not. Apply off-peak).
--
-- The check reads, once a day,
--   WHERE provider_kind = 'alternate-route' AND completed_at >= … AND completed_at < …
-- the jobs the alternate route held that completed in the days it checks,
-- through this partial index of exactly those rows: every other job (every job
-- on the default provider) stays out of it.
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_jobs_alternate_route_completed
  ON public.jobs (completed_at)
  WHERE provider_kind = 'alternate-route';
