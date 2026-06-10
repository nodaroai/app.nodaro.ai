-- 211_finalize_claim_claimant.sql
--
-- Claimant identity for the finalize claim (audit H1, follow-up to 210).
--
-- Problem: the claim was anonymous, so a BullMQ stall re-pick of the SAME job
-- (the crashed worker's retry) could lose to its own predecessor's dead claim
-- when the re-pick landed inside the [lock-expiry, claim-TTL) window — the
-- inline reconcile then exited {ok:false} and recovery waited for the cron at
-- max(staleness threshold, claim expiry), up to ~13 extra minutes.
--
-- Fix: stamp WHO claimed (`finalize_claimed_by`: 'worker' | 'cron') and let a
-- caller re-claim a fresh claim held by the SAME claimant. The worker (and
-- its stall re-pick, which reconciles inline as claimant 'worker') instantly
-- takes over its crashed predecessor's claim; the cron still cannot steal a
-- live worker claim before the TTL, and vice versa. A zombie predecessor
-- (stalled-but-alive) degrades to a benign duplicate upload — safe since the
-- failure-path delete was removed from uploadToR2 (incident 2026-06-10) and
-- markJobCompleted is live-status CAS'd.
--
-- p_claimant NULL (old code during the deploy window) keeps 210 semantics:
-- the NULL-claimant match arm is explicitly disabled so two old-code callers
-- cannot steal each other's fresh claims via NULL = NULL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS + CREATE,
-- re-asserted REVOKE/GRANT.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS finalize_claimed_by text;

COMMENT ON COLUMN public.jobs.finalize_claimed_by IS
  'Who holds the finalize claim (''worker'' | ''cron''). Same-claimant callers may re-claim a fresh claim (stall re-pick takeover); cross-claimant takeover requires TTL expiry.';

-- The 210 signature must be dropped, not overloaded — PostgREST RPC dispatch
-- with named args would otherwise be ambiguous between the two functions.
DROP FUNCTION IF EXISTS public.claim_job_finalize(uuid, integer);

CREATE OR REPLACE FUNCTION public.claim_job_finalize(
  p_job_id uuid,
  p_ttl_seconds integer DEFAULT 600,
  p_claimant text DEFAULT NULL
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
  -- the loser re-evaluates the predicate against the fresh claim and matches
  -- zero rows. Status gate doubles as a TOCTOU-free terminal-state check.
  UPDATE public.jobs
  SET finalize_claimed_at = v_now,
      finalize_claimed_by = p_claimant
  WHERE id = p_job_id
    AND status IN ('pending', 'processing')
    AND (
      finalize_claimed_at IS NULL
      OR finalize_claimed_at < v_now - make_interval(secs => p_ttl_seconds)
      -- Same-claimant re-entry (stall re-pick). NULL claimants never match
      -- each other — old-code callers keep strict 210 semantics.
      OR (p_claimant IS NOT NULL AND finalize_claimed_by = p_claimant)
    )
  RETURNING finalize_claimed_at INTO v_claimed;

  RETURN v_claimed;  -- NULL when the claim was not won
END;
$$;

-- Backend service-role only — clients must never claim/block job finalization.
REVOKE EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_finalize(uuid, integer, text) TO service_role;
