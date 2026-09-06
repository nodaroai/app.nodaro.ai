-- ============================================================================
-- 385 — `profiles.email` joins the columns a user may NOT rewrite
-- ============================================================================
-- WHY. `profiles.email` is not decoration: `lib/sso-linking.ts` resolves the
-- account an SSO assertion belongs to by matching this column, and
-- `routes/sso.ts` then mints the session for that account's address. The
-- "Users can update own safe columns" policy (migration 365) is a DENYLIST —
-- every column it does not name is writable by the row's owner with their own
-- JWT, and the browser already updates this table that way
-- (`frontend/src/lib/workspace-context.ts:201` writes `last_workspace_id`).
-- `email` was never on the list.
--
-- What that allowed, on a deployment that names a `billing.payerAccount`:
--   * any authenticated user writes the BILLING ACCOUNT's address into their
--     own row. `idx_profiles_email` (migration 099) is a plain, non-unique
--     index, so the row is accepted and two rows now carry the address;
--     `maybeSingle()` then errors and the billing account's SSO sign-in is
--     refused — a one-request denial of service on the money account's front
--     door, leaving only the break-glass password;
--   * and because nothing re-syncs this column when an auth email changes
--     (the `001` trigger only INSERTs), a payer whose auth address was renamed
--     has a STALE row — after which the squatter's row is the SOLE match.
--
-- The second half is closed in code as well (`sso-linking.ts` cross-checks the
-- resolved account's own auth email against the assertion, and honours the
-- multi-row error instead of falling through to provisioning); this migration
-- closes the first half, which no code check can — the duplicate row is what
-- breaks the lookup. Both, because the column has no business being writable
-- from a browser either way: the authoritative address lives in `auth.users`.
--
-- SHAPE. Exactly migration 365's, which is exactly 310's: drop the policy
-- first (it binds the old overload), drop the old 19-arg overload explicitly so
-- no orphan is left behind, recreate with the new column, recreate the policy.
-- One file = one transaction, so there is no policy-less window. The
-- `search_path` pin is restated inline (the migration 176 lesson: CREATE OR
-- REPLACE drops function-level SET unless restated).
--
-- NOT AFFECTED. Every backend write to this table goes through the service
-- role, which bypasses RLS; `handle_new_user` is SECURITY DEFINER. The only
-- user-JWT write in the product is `last_workspace_id`, which stays allowed.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can update own safe columns" ON public.profiles;
DROP FUNCTION IF EXISTS check_profiles_update_allowed(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT, INTEGER, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, INTEGER, DATE, TEXT);

CREATE OR REPLACE FUNCTION check_profiles_update_allowed(
  p_user_id UUID,
  p_role TEXT,
  p_tier TEXT,
  p_subscription_tier TEXT,
  p_subscription_credits INTEGER,
  p_topup_credits INTEGER,
  p_daily_spent_credits INTEGER,
  p_credits_balance INTEGER,
  p_storage_limit_bytes BIGINT,
  p_lifetime_topup_credits INTEGER,
  p_last_topup_at TIMESTAMPTZ,
  p_auto_recharge_enabled BOOLEAN,
  p_auto_recharge_threshold_credits INTEGER,
  p_auto_recharge_amount_usd INTEGER,
  p_auto_recharge_failure_count INTEGER,
  p_auto_recharge_last_attempt_at TIMESTAMPTZ,
  p_auto_recharge_daily_count INTEGER,
  p_auto_recharge_daily_date DATE,
  p_free_grant_state TEXT,
  p_email TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT role, tier, subscription_tier, subscription_credits, topup_credits,
         daily_spent_credits, credits_balance, storage_limit_bytes,
         lifetime_topup_credits, last_topup_at,
         auto_recharge_enabled, auto_recharge_threshold_credits,
         auto_recharge_amount_usd, auto_recharge_failure_count,
         auto_recharge_last_attempt_at, auto_recharge_daily_count,
         auto_recharge_daily_date, free_grant_state, email
  INTO v FROM profiles WHERE id = p_user_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  RETURN (p_role IS NOT DISTINCT FROM v.role)
    AND (p_tier IS NOT DISTINCT FROM v.tier)
    AND (p_subscription_tier IS NOT DISTINCT FROM v.subscription_tier)
    AND (p_subscription_credits IS NOT DISTINCT FROM v.subscription_credits)
    AND (p_topup_credits IS NOT DISTINCT FROM v.topup_credits)
    AND (p_daily_spent_credits IS NOT DISTINCT FROM v.daily_spent_credits)
    AND (p_credits_balance IS NOT DISTINCT FROM v.credits_balance)
    AND (p_storage_limit_bytes IS NOT DISTINCT FROM v.storage_limit_bytes)
    AND (p_lifetime_topup_credits IS NOT DISTINCT FROM v.lifetime_topup_credits)
    AND (p_last_topup_at IS NOT DISTINCT FROM v.last_topup_at)
    AND (p_auto_recharge_enabled IS NOT DISTINCT FROM v.auto_recharge_enabled)
    AND (p_auto_recharge_threshold_credits IS NOT DISTINCT FROM v.auto_recharge_threshold_credits)
    AND (p_auto_recharge_amount_usd IS NOT DISTINCT FROM v.auto_recharge_amount_usd)
    AND (p_auto_recharge_failure_count IS NOT DISTINCT FROM v.auto_recharge_failure_count)
    AND (p_auto_recharge_last_attempt_at IS NOT DISTINCT FROM v.auto_recharge_last_attempt_at)
    AND (p_auto_recharge_daily_count IS NOT DISTINCT FROM v.auto_recharge_daily_count)
    AND (p_auto_recharge_daily_date IS NOT DISTINCT FROM v.auto_recharge_daily_date)
    AND (p_free_grant_state IS NOT DISTINCT FROM v.free_grant_state)
    AND (p_email IS NOT DISTINCT FROM v.email);
END;
$$;

CREATE POLICY "Users can update own safe columns" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND check_profiles_update_allowed(
      id, role, tier, subscription_tier,
      subscription_credits, topup_credits, daily_spent_credits,
      credits_balance, storage_limit_bytes,
      lifetime_topup_credits, last_topup_at,
      auto_recharge_enabled, auto_recharge_threshold_credits,
      auto_recharge_amount_usd, auto_recharge_failure_count,
      auto_recharge_last_attempt_at, auto_recharge_daily_count,
      auto_recharge_daily_date, free_grant_state, email
    )
  );
