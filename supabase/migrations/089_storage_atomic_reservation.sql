-- Migration 089: Atomic storage reservation RPC
--
-- Closes the concurrent-upload quota oversubscription window. Per-request
-- snapshots (see backend/src/middleware/credit-guard.ts) cannot bound the
-- aggregate of N concurrent uploads against a single user's quota, because
-- each request observes the same pre-upload usage and then increments
-- post-hoc. A user at 400 MB remaining can currently start 20 parallel
-- /v1/save-to-storage calls and end up ~8 GB over quota.
--
-- This function takes a row-level lock on the target profile, resolves the
-- effective quota (admin-override DB limit, else tier fallback), and commits
-- the increment if — and only if — the resulting usage stays within quota.
-- Callers pair reservations with refunds: refund (increment_storage with a
-- negative delta) the unused portion after upload, or the full reservation
-- if the upload failed.
--
-- Tier ladder matches check_storage_quota() in migration 025 and
-- TIER_STORAGE_LIMITS in backend/src/billing/stripe-config.ts.
-- ============================================================

CREATE OR REPLACE FUNCTION reserve_storage_if_within_limit(
  p_user_id UUID,
  p_bytes BIGINT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_tier      TEXT;
  v_current   BIGINT;
  v_db_limit  BIGINT;
  v_quota     BIGINT;
BEGIN
  IF p_bytes IS NULL OR p_bytes <= 0 THEN
    RETURN FALSE;
  END IF;

  SELECT tier,
         COALESCE(storage_used_bytes, 0),
         COALESCE(storage_limit_bytes, 0)
    INTO v_tier, v_current, v_db_limit
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Prefer DB-stored limit (admin override). The 524288000 sentinel is the
  -- stale 500MB default from an old default-value migration; treat it as
  -- "unset" and fall through to the tier ladder.
  IF v_db_limit > 0 AND v_db_limit <> 524288000 THEN
    v_quota := v_db_limit;
  ELSE
    v_quota := CASE v_tier
      WHEN 'free'       THEN   1073741824  --   1 GB
      WHEN 'basic'      THEN  10737418240  --  10 GB
      WHEN 'standard'   THEN  26843545600  --  25 GB
      WHEN 'pro'        THEN  53687091200  --  50 GB
      WHEN 'business'   THEN 214748364800  -- 200 GB
      WHEN 'enterprise' THEN 536870912000  -- 500 GB
      ELSE                    1073741824   --   1 GB default
    END;
  END IF;

  IF v_current + p_bytes > v_quota THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles
     SET storage_used_bytes = v_current + p_bytes
   WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Only the backend (service_role) calls this; keep authenticated/anon out.
REVOKE EXECUTE ON FUNCTION reserve_storage_if_within_limit(UUID, BIGINT)
  FROM authenticated, anon;
