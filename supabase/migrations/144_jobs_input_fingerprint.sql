-- 144: Add input_fingerprint column for anti-double-click dedup.
--
-- creditGuard middleware computes a SHA-256 over (req.url + stable-stringified
-- body) and checks for a recent row with the same fingerprint from the same
-- user. If found within DEDUP_TTL (10s), the duplicate POST short-circuits
-- with the existing job_id instead of creating a new job + reservation.
--
-- The partial index drops NULL rows (every job pre-dedup-rollout) — keeps the
-- index tight and matches our query predicate.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS input_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS jobs_dedup_idx
  ON public.jobs (user_id, input_fingerprint, created_at DESC)
  WHERE input_fingerprint IS NOT NULL;
