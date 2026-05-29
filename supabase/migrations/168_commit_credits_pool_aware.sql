-- 168: commit_credits — refund the overestimate surplus to the ORIGINATING
-- credit pools, not unconditionally to topup_credits.
--
-- Bug
-- ---
-- When a job's actual provider cost lands below the reserved estimate (routine
-- for per-second Replicate billing and duration-tiered estimates), commit_credits
-- (migration 072) refunded the difference with:
--   UPDATE profiles SET topup_credits = topup_credits + v_diff
-- It never read the from_sub / from_topup split that reserve_credits records in
-- usage_logs.metadata. So a user whose reservation was funded from monthly-
-- resetting subscription_credits got the surplus back as NEVER-EXPIRING
-- topup_credits. Because renewal SETs (not adds) subscription_credits to the tier
-- allotment, that mis-pooled surplus survives the monthly reset it should have
-- been wiped by — a slow, user-favoring accounting drift. refund_credits
-- (migration 025/060) was already fixed for this exact class; commit_credits was
-- the only credit RPC never given the pool-attribution treatment.
--
-- Fix
-- ---
-- Read from_sub / from_topup from usage_logs.metadata (same source refund_credits
-- uses) and refund the surplus topup-first: the kept `actual` then stays
-- attributed subscription-first, matching reserve_credits' subscription-first
-- deduction order. Clamp each pool's refund to what it actually contributed, so
-- a pool is never credited more than it funded. Legacy rows with no pool metadata
-- fall back to the prior all-to-topup behavior.
--
-- Signature unchanged: commit_credits(UUID, INTEGER). No application code change.

CREATE OR REPLACE FUNCTION commit_credits(p_usage_log_id UUID, p_actual_credits INTEGER DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_reserved INTEGER;
  v_actual INTEGER;
  v_diff INTEGER;
  v_metadata JSONB;
  v_from_sub INTEGER;
  v_from_topup INTEGER;
  v_refund_topup INTEGER;
  v_refund_sub INTEGER;
BEGIN
  SELECT user_id, credits_used, metadata
  INTO v_user_id, v_reserved, v_metadata
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  v_actual := COALESCE(p_actual_credits, v_reserved);

  -- If actual < reserved, refund the surplus to the originating pool(s).
  IF v_actual < v_reserved THEN
    v_diff := v_reserved - v_actual;

    v_from_sub := COALESCE((v_metadata->>'from_sub')::INTEGER, 0);
    v_from_topup := COALESCE((v_metadata->>'from_topup')::INTEGER, 0);

    IF v_from_sub + v_from_topup = 0 THEN
      -- Legacy row without pool metadata → preserve prior all-to-topup behavior.
      v_refund_topup := v_diff;
      v_refund_sub := 0;
    ELSE
      -- Refund the LAST-deducted pool first (topup), so the kept `actual` stays
      -- attributed subscription-first. Clamp to each pool's contribution:
      --   v_diff <= v_reserved = v_from_sub + v_from_topup, so v_refund_sub
      --   (= v_diff - min(v_diff, v_from_topup)) is always <= v_from_sub.
      v_refund_topup := LEAST(v_diff, v_from_topup);
      v_refund_sub := v_diff - v_refund_topup;
    END IF;

    UPDATE profiles
    SET subscription_credits = subscription_credits + v_refund_sub,
        topup_credits = topup_credits + v_refund_topup
    WHERE id = v_user_id;
  END IF;

  UPDATE usage_logs
  SET status = 'committed',
      credits_charged = v_actual
  WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION commit_credits(UUID, INTEGER) SET search_path = public;
REVOKE ALL ON FUNCTION commit_credits(UUID, INTEGER) FROM authenticated, anon;
