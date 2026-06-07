-- 197_admin_adjust_credits_rpc.sql
--
-- Define the `admin_adjust_credits` RPC that
-- CreditsService.adminAdjustCredits (backend/src/ee/billing/credits.ts) has
-- always called but which NO migration ever created. Because the function was
-- absent, `supabase.rpc("admin_adjust_credits", …)` always errored and every
-- admin credit adjustment fell through to the JS read-then-write fallback — a
-- non-atomic SELECT-then-UPDATE that races a concurrent reserve/commit/refund
-- on the same user. (The "Atomic update … avoid TOCTOU race condition" comment
-- above the call described a code path that never actually ran.)
--
-- This function does the adjustment in a single atomic UPDATE (the row lock is
-- held for the statement), clamps at 0 via GREATEST, validates p_field against
-- an allowlist (defence-in-depth; the value is server-supplied), and returns
-- the post-update balances as a json object shaped EXACTLY as the JS expects:
-- { subscription_credits, topup_credits }. With the RPC present, the JS takes
-- its success branch and the read-then-write fallback becomes a true safety net.
--
-- SECURITY DEFINER + REVOKE from anon/authenticated: only the service-role
-- backend (or a superuser) may invoke it. search_path pinned per the 176/194/196
-- convergence pattern. Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION admin_adjust_credits(
  p_user_id UUID,
  p_field TEXT,
  p_amount INTEGER
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub INTEGER;
  v_top INTEGER;
BEGIN
  IF p_field NOT IN ('subscription_credits', 'topup_credits') THEN
    RAISE EXCEPTION 'admin_adjust_credits: invalid field %', p_field;
  END IF;

  IF p_field = 'subscription_credits' THEN
    UPDATE profiles
       SET subscription_credits = GREATEST(0, COALESCE(subscription_credits, 0) + p_amount)
     WHERE id = p_user_id
     RETURNING subscription_credits, topup_credits INTO v_sub, v_top;
  ELSE
    UPDATE profiles
       SET topup_credits = GREATEST(0, COALESCE(topup_credits, 0) + p_amount)
     WHERE id = p_user_id
     RETURNING subscription_credits, topup_credits INTO v_sub, v_top;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_adjust_credits: user profile not found %', p_user_id;
  END IF;

  RETURN json_build_object('subscription_credits', v_sub, 'topup_credits', v_top);
END;
$$;

REVOKE ALL ON FUNCTION admin_adjust_credits(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_adjust_credits(UUID, TEXT, INTEGER) FROM anon, authenticated;
