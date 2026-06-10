-- 210_finalize_claim.sql
--
-- Finalize-phase mutual exclusion between the worker and the reconcile cron.
--
-- Both finalize the same job through finalizeJobWithMedia (backend/src/lib/
-- job-finalize.ts): the worker when its provider poll returns, the reconcile
-- cron when the job crosses its staleness threshold while still `processing`.
-- Without a claim they would each download the provider result and upload the
-- same deterministic R2 key (`images/<jobId>.png`) concurrently. Combined with
-- the (since removed) failure-path delete in uploadToR2, the losing writer's
-- failed upload deleted the winning writer's live object — a `completed` job
-- whose image 404s forever (incident 2026-06-10, job 7955772a).
--
-- claim_job_finalize CAS-claims the job for one finalizer:
--   * wins  -> stamps finalize_claimed_at = now() and returns that timestamp
--   * loses -> returns NULL (another finalizer holds an unexpired claim, or
--              the row is already terminal)
-- The claim expires after p_ttl_seconds so a crashed claimant self-heals; a
-- finalizer that fails its media step releases the claim early (scoped UPDATE
-- in job-finalize.ts) so retries don't wait out the TTL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + re-asserted
-- REVOKE/GRANT. Adding a nullable column is metadata-only (no table rewrite).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS finalize_claimed_at timestamptz;

COMMENT ON COLUMN public.jobs.finalize_claimed_at IS
  'Finalize-phase claim stamp (claim_job_finalize RPC). A finalizer holding an unexpired claim is exclusively downloading/uploading this job''s media; NULL or expired means the finalize phase is up for grabs.';

CREATE OR REPLACE FUNCTION public.claim_job_finalize(
  p_job_id uuid,
  p_ttl_seconds integer DEFAULT 600
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_claimed timestamptz;
BEGIN
  -- Single UPDATE = atomic CAS: concurrent callers serialize on the row lock;
  -- the second caller re-evaluates the predicate against the fresh claim and
  -- matches zero rows. Status gate doubles as a terminal-state check so a
  -- cancelled/completed row can never be claimed (TOCTOU-free, unlike the
  -- caller's earlier status read).
  UPDATE public.jobs
  SET finalize_claimed_at = v_now
  WHERE id = p_job_id
    AND status IN ('pending', 'processing')
    AND (
      finalize_claimed_at IS NULL
      OR finalize_claimed_at < v_now - make_interval(secs => p_ttl_seconds)
    )
  RETURNING finalize_claimed_at INTO v_claimed;

  RETURN v_claimed;  -- NULL when the claim was not won
END;
$$;

-- Backend service-role only — clients must never claim/block job finalization.
REVOKE EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer) TO service_role;
