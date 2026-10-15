-- ============================================================================
-- 527 — Monthly credits on yearly plans (decided 2026-10-15)
-- ============================================================================
-- WHY. Every paid plan is sold as "N credits / month", on the yearly price as
-- well as the monthly one. Subscription credits were reset only when Stripe
-- moved the billing period (the `customer.subscription.updated` renewal and
-- its hourly safety net): every month on a monthly price, but ONCE A YEAR on a
-- yearly one — a yearly subscriber received one month's credits per year.
--
-- WHAT CHANGES. An hourly cron step (backend/src/ee/billing/
-- yearly-plan-monthly-credits.ts) finds every ACTIVE subscription on a YEARLY
-- price and, at each monthly anchor of its current period — period start +
-- k calendar months, the day clamped to the month's last day (Jan 31 → Feb 28
-- → Mar 31), computed in UTC by monthly-credit-anchors.ts — SETs
-- `subscription_credits` to the plan's monthly amount, exactly as the renewal
-- does on a monthly price. Unused subscription credits do not roll over; top-up
-- credits are never touched. The anchor AT the period end is the next period's
-- start and belongs to the renewal, so the year-end renewal is never granted
-- twice. Monthly prices keep the renewal + safety net, unchanged.
--
-- THIS FILE:
--   1. `credits_reset_at` joins the profiles UPDATE denylist. The monthly
--      grant is due when that stamp is older than the month's anchor, and the
--      "Users can update own safe columns" policy is a DENYLIST — a column it
--      does not name is writable by the row's owner with their own browser JWT.
--      Left writable, a yearly subscriber could rewind it and collect a fresh
--      month of credits every hour. Nothing in the product writes it from a
--      browser; every writer (the Stripe handlers, the renewal cron, the
--      function below) is the service role, which bypasses RLS.
--   2. `subscriptions.collection_paused` — Stripe's "pause payment
--      collection", written by the subscription.updated webhook.
--   3. `grant_yearly_plan_monthly_credits` — the grant, atomic and idempotent.
--      It locks the profile row, re-reads the subscription under that lock and
--      grants only if it is still active and not paused, the profile is not
--      marked ended, on the price the cron read, in the period the cron read
--      and before that period has ended, with the anchor inside that period
--      and already reached, and the profile's `credits_reset_at` still before
--      the anchor.
--      The grant moves `credits_reset_at` to now(), so a second caller for the
--      same anchor — a concurrent run on another replica, or staging and
--      production sharing this database — waits on the lock and then refuses.
--      The renewal writes the same stamp, so the cron and the webhook never
--      both grant one month. The ledger row is written in the same transaction.
--
-- FIRST RUN. Existing yearly subscribers get ONE grant on the first hourly run
-- after this file is applied: the pool is SET to their plan's monthly amount
-- for the current month (whatever was left of the earlier grant is replaced),
-- `credits_reset_at` moves, and a "Monthly credits — yearly plan" ledger row is
-- written. Earlier months are not back-paid.
--
-- IDEMPOTENT ON A SECOND APPLY: DROP-then-CREATE for the policy, an explicit
-- drop of the old guard overload, ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE
-- for both functions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. credits_reset_at joins the profiles UPDATE denylist.
--
-- Same shape as 365/385/426: drop the policy (it binds the old overload), drop
-- the old 21-argument overload explicitly so no orphan is left resolvable,
-- recreate the guard with the extra column, recreate the policy that passes it.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own safe columns" ON public.profiles;
DROP FUNCTION IF EXISTS check_profiles_update_allowed(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT, INTEGER, TIMESTAMPTZ, BOOLEAN, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ, INTEGER, DATE, TEXT, TEXT, BOOLEAN);

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
  p_email TEXT,
  p_welcome_consent_pending BOOLEAN,
  p_credits_reset_at TIMESTAMPTZ
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
         auto_recharge_daily_date, free_grant_state, email,
         welcome_consent_pending, credits_reset_at
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
    AND (p_email IS NOT DISTINCT FROM v.email)
    AND (p_welcome_consent_pending IS NOT DISTINCT FROM v.welcome_consent_pending)
    AND (p_credits_reset_at IS NOT DISTINCT FROM v.credits_reset_at);
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
      auto_recharge_daily_date, free_grant_state, email,
      welcome_consent_pending, credits_reset_at
    )
  );

-- ---------------------------------------------------------------------------
-- 2. subscriptions.collection_paused.
--
-- Stripe's "pause payment collection" (set by an operator in the Dashboard or
-- the API, or by a customer if the Dashboard's portal configuration allows it)
-- leaves the subscription 'active' and changes nothing else on the event, so
-- without this column a paused yearly plan would keep receiving its monthly
-- credits. The webhook's `customer.subscription.updated` handler writes it
-- (`pause_collection` set or not); the grant below refuses a paused row.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS collection_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscriptions.collection_paused IS
  'Stripe pause_collection is set on the subscription (payment collection paused; status stays active). Written by the subscription.updated webhook; the monthly grant on yearly plans (grant_yearly_plan_monthly_credits) pays nothing while it is true.';

-- ---------------------------------------------------------------------------
-- 3. The grant.
--
-- The caller passes the anchor; this function never recomputes the calendar
-- (that lives in one place, monthly-credit-anchors.ts) — it checks the
-- invariants that make a grant safe, under the lock that makes them stay true:
--   - lock order is the profile, then the subscription. Every pool write takes
--     the profile row (the renewal's UPDATE, reserve/commit/refund), and no
--     writer holds a subscription row while it waits for a profile;
--   - the subscription is re-read FOR SHARE, so a price or period change
--     cannot commit between the check and the grant;
--   - the period start must be the one the caller read: a renewal that moved
--     the period in between makes this call refuse, and the next run decides
--     from the new period;
--   - the anchor must lie inside [period start, period end), before a
--     scheduled cancel_at, and not in the future. The caller computes anchors
--     at millisecond precision (JavaScript dates), so the start is compared
--     at that precision too: a start stored with microseconds must not make
--     its own first anchor (k = 0) look early;
--   - the period must not have ended yet: after it, the turn of the year is
--     the renewal's, and a late month-11 grant would stamp credits_reset_at
--     past the period end and make the safety net skip that renewal;
--   - the profile must not be marked ended (subscription_ended_at, which the
--     cancel handler sets even when its update of the subscription row fails)
--     and the subscription's payment collection must not be paused;
--   - the profile's credits_reset_at must still be before the anchor (NULL =
--     never reset, which grants).
-- Returns true when it granted, false for every refusal; a refusal changes
-- nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_yearly_plan_monthly_credits(
  p_user_id uuid,
  p_subscription_id uuid,
  p_price_id text,
  p_period_start timestamptz,
  p_anchor timestamptz,
  p_credits integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reset_at timestamptz;
  v_ended_at timestamptz;
  v_sub record;
BEGIN
  IF p_user_id IS NULL OR p_subscription_id IS NULL OR p_price_id IS NULL
     OR p_period_start IS NULL OR p_anchor IS NULL
     OR p_credits IS NULL OR p_credits <= 0 THEN
    RETURN false;
  END IF;

  SELECT credits_reset_at, subscription_ended_at INTO v_reset_at, v_ended_at
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The cancel handler marks the PROFILE ended even when its own update of the
  -- subscription row fails (that row then stays 'active' forever); the
  -- created and updated handlers clear the mark. An ended profile is paid
  -- nothing, whatever the subscription row still says.
  IF v_ended_at IS NOT NULL THEN
    RETURN false;
  END IF;

  SELECT status, stripe_price_id, current_period_start, current_period_end, cancel_at, collection_paused
    INTO v_sub
    FROM subscriptions
   WHERE id = p_subscription_id
     AND user_id = p_user_id
     FOR SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_sub.status IS DISTINCT FROM 'active'
     OR v_sub.stripe_price_id IS DISTINCT FROM p_price_id
     OR v_sub.current_period_start IS DISTINCT FROM p_period_start
     OR v_sub.current_period_end IS NULL
     OR p_anchor < date_trunc('milliseconds', v_sub.current_period_start)
     OR p_anchor >= v_sub.current_period_end
     OR (v_sub.cancel_at IS NOT NULL AND p_anchor >= v_sub.cancel_at)
     OR v_sub.collection_paused
     OR now() >= v_sub.current_period_end
     OR p_anchor > now() THEN
    RETURN false;
  END IF;

  IF v_reset_at IS NOT NULL AND v_reset_at >= p_anchor THEN
    RETURN false;
  END IF;

  UPDATE profiles
     SET subscription_credits = p_credits,
         credits_reset_at = now()
   WHERE id = p_user_id;

  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, balance_after)
  VALUES (p_user_id, p_credits, 'subscription', 'subscription_renewal', 'Monthly credits — yearly plan', p_credits);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer) FROM anon;
REVOKE ALL ON FUNCTION public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_yearly_plan_monthly_credits(uuid, uuid, text, timestamptz, timestamptz, integer) TO service_role;

-- A new function and a changed guard signature: PostgREST caches the schema
-- and answers "function not found" until it reloads (the lesson recorded in 366).
NOTIFY pgrst, 'reload schema';
