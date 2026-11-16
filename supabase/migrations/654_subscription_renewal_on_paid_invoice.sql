-- ============================================================================
-- 654 — A failed renewal charge puts the period's credits on hold; they come
-- back once, when the renewal is paid
-- ============================================================================
-- WHY. Stripe moves a subscription's billing period when it creates the
-- renewal invoice and charges that invoice about an hour later; a declined
-- charge makes the subscription `past_due` (and `unpaid` once Stripe stops
-- retrying, where the account is set up that way). The period move resets the
-- subscription credits to the plan's monthly allocation. A renewal whose card
-- was declined therefore kept a full month of credits, usable through the
-- whole retry window and kept even when the subscription then ended unpaid.
--
-- WHAT CHANGES. The reset at the period move stays as it is for a
-- subscription that is paid up (the webhook now resets only on an event that
-- says `active` or `trialing`). When the renewal charge fails, the credits
-- left for that period are put on hold: recorded on the subscription row
-- against its current period and taken out of the pool, once per period. When
-- the renewal invoice is paid they come back, once: ADDED to the pool, so
-- anything granted during the hold (a plan upgrade's gap) is kept. A period
-- that was never reset (its move arrived `past_due`, or never arrived) is set
-- to the plan's allocation when its invoice is paid. Every paid renewal
-- invoice is recorded in `transactions`, as before. Paying subscribers see no
-- change; plan changes, monthly <-> yearly switches, the yearly plans'
-- monthly grant and the hourly safety net are untouched.
--
-- THIS FILE:
--   1. `subscriptions.renewal_hold_period_start` + `renewal_credits_held` —
--      the hold. On the subscription row because a hold belongs to one
--      subscription's one billing period, and both functions below lock that
--      row anyway. The row has no browser write path (RLS: SELECT only), so an
--      owner cannot raise a held amount. `renewal_hold_period_start` is the
--      period the columns describe and stays after the hold is released, so a
--      late or redelivered `past_due` event for a period already settled never
--      holds again; `renewal_credits_held` is the amount still on hold (NULL
--      when none is).
--   2. `hold_subscription_renewal_credits` — the hold, under the profile's row
--      lock. Returns the amount held, or NULL when it held nothing.
--   3. `release_subscription_renewal_credits` — the paid renewal invoice,
--      under the profile's row lock: decides, claims the invoice (its
--      transactions row, UNIQUE stripe_transaction_id), then releases, catches
--      up, or gives nothing. Returns what it did.
-- Both functions are service-role only.
--
-- IDEMPOTENT ON A SECOND APPLY: ADD COLUMN IF NOT EXISTS, the CHECK dropped
-- and re-added, CREATE OR REPLACE for both functions, and the REVOKE / GRANT
-- statements state the same privileges again.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The hold, on the subscription row.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS renewal_hold_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_credits_held integer;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_renewal_credits_held_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_renewal_credits_held_check
  CHECK (renewal_credits_held IS NULL OR (renewal_credits_held >= 0 AND renewal_hold_period_start IS NOT NULL));

COMMENT ON COLUMN public.subscriptions.renewal_hold_period_start IS
  'The billing period (its start) the renewal hold columns describe: held when its renewal charge failed, or settled when its renewal invoice was paid. Kept after a release, so the same period is never held twice.';
COMMENT ON COLUMN public.subscriptions.renewal_credits_held IS
  'Subscription credits on hold for renewal_hold_period_start because its renewal charge failed; NULL when none are (never held, released, or discarded).';

-- ---------------------------------------------------------------------------
-- 2. The hold.
--
-- Lock order is the profile, then the subscription — the order 527 and 603
-- use: every pool write takes the profile row first. Held at most once per
-- period: a period already held or settled, an older period than one already
-- held or settled, or one the subscription has already left is refused. The
-- whole pool is held (never below zero); top-up credits are never touched.
-- An ended or never-granted subscription holds nothing. Bad input returns
-- NULL rather than raising: the caller turns a database error into a
-- redelivery, and a call that cannot succeed must not be retried.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hold_subscription_renewal_credits(
  p_user_id                uuid,
  p_stripe_subscription_id text,
  p_period_start           timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pool integer;
  v_held integer;
  v_sub  record;
BEGIN
  IF p_user_id IS NULL OR p_stripe_subscription_id IS NULL OR length(p_stripe_subscription_id) = 0
     OR p_period_start IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT subscription_credits INTO v_pool
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT id, status, plan_granted, current_period_start, renewal_hold_period_start
    INTO v_sub
    FROM subscriptions
   WHERE stripe_subscription_id = p_stripe_subscription_id
     AND user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_sub.status IN ('canceled', 'expired', 'incomplete_expired')
     OR v_sub.plan_granted IS NOT TRUE THEN
    RETURN NULL;
  END IF;

  -- Once per period: this period (or a later one) is already held or settled.
  IF v_sub.renewal_hold_period_start IS NOT NULL AND v_sub.renewal_hold_period_start >= p_period_start THEN
    RETURN NULL;
  END IF;

  -- A late event for a period the subscription has already left.
  IF v_sub.current_period_start IS NOT NULL AND p_period_start < v_sub.current_period_start THEN
    RETURN NULL;
  END IF;

  v_held := GREATEST(COALESCE(v_pool, 0), 0);

  UPDATE subscriptions
     SET renewal_hold_period_start = p_period_start,
         renewal_credits_held = v_held
   WHERE id = v_sub.id;

  IF v_held > 0 THEN
    UPDATE profiles SET subscription_credits = 0 WHERE id = p_user_id;
  END IF;

  RETURN v_held;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_subscription_renewal_credits(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hold_subscription_renewal_credits(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.hold_subscription_renewal_credits(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hold_subscription_renewal_credits(uuid, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The paid renewal invoice.
--
-- Same lock order. It DECIDES first and writes nothing until the claim lands,
-- so a redelivered invoice (the claim already there) changes nothing:
--   - unknown profile or subscription: 'unknown', nothing recorded;
--   - ended, never granted, profile marked ended, or no period on the
--     invoice: recorded, nothing given;
--   - an invoice for a period that is no longer the subscription's current
--     one — older than the stored period, older than the period the hold
--     columns describe, or already over — is recorded and gives nothing; a
--     hold for that period or an earlier one is discarded (those credits would
--     have expired with the period anyway);
--   - otherwise it is the current period's renewal, and:
--       * never reset for this period (`credits_reset_at` before its start):
--         the pool is SET to the plan's allocation and the reset stamped (the
--         catch-up); a hold, which can then only hold an earlier period's
--         credits, is discarded. 'unpriced' when nothing prices the plan;
--       * held for this period: the held amount is ADDED back;
--       * reset at the move and never held (the normal case): nothing.
--     Either way the period is marked settled, so a later `past_due` event
--     for it holds nothing.
-- Period starts are compared within a day: the hold's comes from the
-- subscription event and the invoice's from its line, and a period is a month
-- or a year long, so a day apart is the same period. A hold the payment does
-- not release (another period's) is reported as 'dropped' so the caller logs it.
-- The catch-up never lowers the pool (a plan upgrade granted while the renewal
-- waited is kept).
-- The claim records what was given (`credits_granted`, 0 when nothing).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_subscription_renewal_credits(
  p_user_id                uuid,
  p_stripe_subscription_id text,
  p_invoice_id             text,
  p_period_start           timestamptz,
  p_period_end             timestamptz,
  p_credits                integer,
  p_amount_usd             numeric,
  p_tier                   text
) RETURNS TABLE (outcome text, credits integer, balance integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reset_at timestamptz;
  v_ended_at timestamptz;
  v_sub      record;
  v_rows     integer;
  v_outcome  text := 'recorded';
  v_give     integer := 0;
  v_current  boolean := false;
  v_balance  integer;
  v_pool     integer;
  v_dropped  integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_stripe_subscription_id IS NULL OR length(p_stripe_subscription_id) = 0
     OR p_invoice_id IS NULL OR length(p_invoice_id) = 0 THEN
    RETURN QUERY SELECT 'unknown'::text, 0, NULL::integer;
    RETURN;
  END IF;

  SELECT credits_reset_at, subscription_ended_at, subscription_credits INTO v_reset_at, v_ended_at, v_pool
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, 0, NULL::integer;
    RETURN;
  END IF;

  SELECT id, status, plan_granted, current_period_start, renewal_hold_period_start, renewal_credits_held
    INTO v_sub
    FROM subscriptions
   WHERE stripe_subscription_id = p_stripe_subscription_id
     AND user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, 0, NULL::integer;
    RETURN;
  END IF;

  -- Decide (no writes yet).
  IF v_sub.status IN ('canceled', 'expired', 'incomplete_expired')
     OR v_sub.plan_granted IS NOT TRUE
     OR v_ended_at IS NOT NULL
     OR p_period_start IS NULL THEN
    v_outcome := 'recorded';
  ELSIF (v_sub.current_period_start IS NOT NULL AND p_period_start < v_sub.current_period_start - interval '1 day')
     OR (v_sub.renewal_hold_period_start IS NOT NULL AND p_period_start < v_sub.renewal_hold_period_start - interval '1 day')
     OR (p_period_end IS NOT NULL AND p_period_end <= now()) THEN
    v_outcome := 'recorded';
  ELSE
    v_current := true;
    IF v_reset_at IS NULL OR v_reset_at < p_period_start THEN
      IF COALESCE(p_credits, 0) > 0 THEN
        v_outcome := 'renewed';
        -- Never below the pool: anything granted while the renewal waited
        -- (a plan upgrade's credits) is kept.
        v_give := GREATEST(p_credits, COALESCE(v_pool, 0));
      ELSE
        v_outcome := 'unpriced';
      END IF;
    ELSIF COALESCE(v_sub.renewal_credits_held, 0) > 0
          AND v_sub.renewal_hold_period_start > p_period_start - interval '1 day'
          AND v_sub.renewal_hold_period_start < p_period_start + interval '1 day' THEN
      v_outcome := 'released';
      v_give := v_sub.renewal_credits_held;
    END IF;
  END IF;

  -- The claim. A redelivered invoice finds its row and stops here.
  INSERT INTO transactions (user_id, stripe_transaction_id, type, amount_usd, credits_granted, tier)
  VALUES (p_user_id, p_invoice_id, 'subscription', GREATEST(COALESCE(p_amount_usd, 0), 0), v_give, p_tier)
  ON CONFLICT (stripe_transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT 'replay'::text, 0, NULL::integer;
    RETURN;
  END IF;

  IF v_outcome = 'renewed' THEN
    UPDATE profiles
       SET subscription_credits = v_give,
           credits_reset_at = now()
     WHERE id = p_user_id
    RETURNING subscription_credits INTO v_balance;
  ELSIF v_outcome = 'released' THEN
    UPDATE profiles
       SET subscription_credits = subscription_credits + v_give
     WHERE id = p_user_id
    RETURNING subscription_credits INTO v_balance;
  END IF;

  IF v_current AND v_outcome NOT IN ('released', 'renewed') AND COALESCE(v_sub.renewal_credits_held, 0) > 0 THEN
    v_dropped := v_sub.renewal_credits_held;
  END IF;

  IF v_current THEN
    -- The current period is settled; any hold for it or an earlier period is
    -- released (above) or discarded.
    UPDATE subscriptions
       SET renewal_hold_period_start = p_period_start,
           renewal_credits_held = NULL
     WHERE id = v_sub.id;
  ELSIF p_period_start IS NOT NULL
        AND v_sub.renewal_credits_held IS NOT NULL
        AND v_sub.renewal_hold_period_start <= p_period_start THEN
    -- An older period's invoice: its hold (or an earlier one) is discarded.
    UPDATE subscriptions SET renewal_credits_held = NULL WHERE id = v_sub.id;
  END IF;

  IF v_dropped > 0 THEN
    -- A hold for another period than this invoice's: reported so the caller
    -- logs it, never silent.
    RETURN QUERY SELECT 'dropped'::text, v_dropped, v_balance;
    RETURN;
  END IF;
  RETURN QUERY SELECT v_outcome, v_give, v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.release_subscription_renewal_credits(uuid, text, text, timestamptz, timestamptz, integer, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_subscription_renewal_credits(uuid, text, text, timestamptz, timestamptz, integer, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.release_subscription_renewal_credits(uuid, text, text, timestamptz, timestamptz, integer, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_subscription_renewal_credits(uuid, text, text, timestamptz, timestamptz, integer, numeric, text) TO service_role;

-- New columns and functions: PostgREST caches the schema and answers "not
-- found" until it reloads (the lesson recorded in 366).
NOTIFY pgrst, 'reload schema';
