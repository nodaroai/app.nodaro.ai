-- ============================================================================
-- 656 — `unpaid` is a storable subscription status, and the renewal safety
-- net grants a period's credits in one locked database call
-- ============================================================================
-- 1. subscriptions.status also accepts `unpaid`: the status Stripe gives a
--    subscription once its payment retries ended without payment (where the
--    account is set up to leave it unpaid rather than cancel it). The CHECK
--    refused it, so the webhook's status write failed and such a row stayed
--    `past_due`. Every reader that treats a stored `past_due` row as the
--    account's live subscription treats `unpaid` the same way, so the account
--    keeps what it had.
--
-- 2. renew_subscription_credits_safety_net — the hourly safety net's grant
--    (an active subscription whose period ended and whose credits were never
--    reset for it). It read the rows, then wrote the profile with a
--    conditional update; a failed renewal charge putting the period's credits
--    on hold (hold_subscription_renewal_credits, migration 654) between that
--    read and that write was still refilled. The function decides and writes
--    under the profile's row lock, then the subscription's (the order every
--    pool write uses), so a hold is either seen or comes after. It refuses
--    unless the subscription is active, its plan granted, nothing is on hold,
--    its stored period end is the one the caller read, and the pool was not
--    reset since that period ended. It SETs the pool to the plan's allocation
--    and stamps the reset. Returns whether it granted. Service-role only.
--
-- Idempotent: the CHECK is dropped if it exists and re-added (as 650 did);
-- CREATE OR REPLACE for the function; the REVOKE / GRANT statements state the
-- same privileges again.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `unpaid` is storable.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trialing', 'past_due', 'unpaid', 'paused', 'canceled', 'incomplete', 'incomplete_expired', 'expired'));

-- ---------------------------------------------------------------------------
-- 2. The safety net's grant.
--
-- Bad input or a refusal returns false rather than raising: the caller skips
-- the row, and the next hourly run reads it again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.renew_subscription_credits_safety_net(
  p_user_id         uuid,
  p_subscription_id uuid,
  p_period_end      timestamptz,
  p_credits         integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reset_at timestamptz;
  v_sub      record;
BEGIN
  IF p_user_id IS NULL OR p_subscription_id IS NULL OR p_period_end IS NULL
     OR p_credits IS NULL OR p_credits < 0 THEN
    RETURN false;
  END IF;

  SELECT credits_reset_at INTO v_reset_at
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT status, plan_granted, renewal_credits_held, current_period_end, collection_paused
    INTO v_sub
    FROM subscriptions
   WHERE id = p_subscription_id
     AND user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_sub.status <> 'active'
     OR v_sub.plan_granted IS NOT TRUE
     OR v_sub.renewal_credits_held IS NOT NULL
     OR v_sub.collection_paused IS TRUE
     OR v_sub.current_period_end IS DISTINCT FROM p_period_end THEN
    RETURN false;
  END IF;

  -- Reset since this period ended (the webhook, or a paid renewal invoice's
  -- catch-up): a second SET would refill what was spent since.
  IF v_reset_at IS NOT NULL AND v_reset_at >= p_period_end THEN
    RETURN false;
  END IF;

  UPDATE profiles
     SET subscription_credits = p_credits,
         credits_reset_at = now()
   WHERE id = p_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_subscription_credits_safety_net(uuid, uuid, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_subscription_credits_safety_net(uuid, uuid, timestamptz, integer) FROM anon;
REVOKE ALL ON FUNCTION public.renew_subscription_credits_safety_net(uuid, uuid, timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.renew_subscription_credits_safety_net(uuid, uuid, timestamptz, integer) TO service_role;

-- A new function: PostgREST caches the schema and answers "not found" until it
-- reloads (the lesson recorded in 366).
NOTIFY pgrst, 'reload schema';
