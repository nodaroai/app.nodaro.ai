-- 176: commit_credits — on a partial commit (actual < reserved), also reverse
-- the SURPLUS portion of the daily-cap counter and the app-credit allowance.
-- Plus: re-pin reserve_credits' search_path (dropped when its signature grew).
--
-- RECOVERY NOTE: this content originally shipped as migration 172 in PR #2919,
-- which was closed because its seedance-2 per-tier piece was superseded by the
-- pricing-convention PR #2931. M1 + M2 (below) were NOT superseded — they are
-- independent accounting/security fixes — so they are re-issued here at a fresh
-- version after 173/174/175 (172 was never deployed; reusing it would mis-order
-- against the already-applied 173-175).
--
-- Bug (M1)
-- --------
-- reserve_credits inflates daily_spent_credits by the FULL reserved estimate and
-- applies the full app-allowance delta (±p_credits). When the job's actual cost
-- lands below the estimate (routine for per-second Replicate + duration-tiered
-- video), commit_credits refunds the surplus credits to the pools (mig 168) but
-- never reversed the surplus portion of daily_spent_credits or
-- app_credits_allowance. refund_credits (171) reverses BOTH on failure; the
-- partial-commit path was the asymmetric gap. Effect: free-tier (and any tier
-- with a daily_credit_limit) users hit the cap earlier than their true spend,
-- and the free-tier app-credit allowance drifts.
--
-- Fix (M1): in the surplus branch, decrement daily_spent_credits by v_diff
-- (clamped, mirroring refund_credits) and reverse the surplus fraction of the
-- allowance delta from metadata (|delta| == reservation, so the surplus fraction
-- is exactly v_diff; LEAST() keeps the reversal within what reserve applied).
--
-- Also (M2): reserve_credits was pinned SET search_path=public in mig 033 for the
-- 6-arg signature; mig 060/169/171 recreated it (7- then 8-arg) without re-
-- pinning, so the most security-sensitive credit RPC ran with a mutable
-- search_path. Re-pin the current 8-arg signature.
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
  v_allowance_delta INTEGER;
  v_allowance_adjust INTEGER;
BEGIN
  SELECT user_id, credits_used, metadata
  INTO v_user_id, v_reserved, v_metadata
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  v_actual := COALESCE(p_actual_credits, v_reserved);

  -- If actual < reserved, refund the surplus to the originating pool(s) AND
  -- reverse the surplus portion of the daily-cap counter + app allowance.
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
      -- attributed subscription-first. Clamp to each pool's contribution.
      v_refund_topup := LEAST(v_diff, v_from_topup);
      v_refund_sub := v_diff - v_refund_topup;
    END IF;

    -- Reverse the surplus fraction of the app-allowance delta reserve applied.
    -- delta < 0 (app run consumed allowance): give back the unused surplus.
    -- delta > 0 (flow run earned allowance): un-earn the surplus.
    v_allowance_delta := COALESCE((v_metadata->>'allowance_delta')::INTEGER, 0);
    IF v_allowance_delta < 0 THEN
      v_allowance_adjust := LEAST(v_diff, -v_allowance_delta);    -- restore (+)
    ELSIF v_allowance_delta > 0 THEN
      v_allowance_adjust := -LEAST(v_diff, v_allowance_delta);    -- un-earn (-)
    ELSE
      v_allowance_adjust := 0;
    END IF;

    UPDATE profiles
    SET subscription_credits = subscription_credits + v_refund_sub,
        topup_credits = topup_credits + v_refund_topup,
        daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_diff),
        app_credits_allowance = GREATEST(0, COALESCE(app_credits_allowance, 0) + v_allowance_adjust)
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

-- M2: re-pin reserve_credits' search_path on the current 8-arg signature.
ALTER FUNCTION reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER)
  SET search_path = public;
