-- One live granted subscription per account, decided where the plan grant is
-- claimed.
--
-- The webhook grants a subscription's plan (the paid tier, the plan's
-- credits, its storage) once, to whichever event claims it: the claim moved
-- subscriptions.plan_granted from false to true with a conditional update
-- (migration 650). Nothing serialized that claim per account, so two
-- subscriptions of one account, both recorded unpaid and both paid at about
-- the same time, could each be claimed and each granted: the second grant
-- overwrote the first, the first's credits moved to top-up as if they were the
-- account's own, and the second's status write then failed on
-- idx_one_active_subscription_per_user, leaving it `incomplete` and granted.
-- A trialing pair is not covered by that index at all.
--
-- 1. subscriptions.plan_claimed_at — when this subscription's plan grant was
--    claimed through claim_subscription_grant. NULL on every row claimed
--    before it existed and on every row whose claim was released (a grant
--    whose write failed gives its claim back and clears it). It closes the
--    window between a claim and the live status the webhook writes only after
--    the grant lands: a claimed row is still `incomplete` then, and the
--    marker is what makes it block. Rows from before migration 650 that were
--    granted by the column's default and never paid (stuck `incomplete`) have
--    no marker, so they never block a new subscription.
--
-- 2. claim_subscription_grant(stripe subscription id, user id) is now the one
--    claim. It locks the account's profile row first (the per-account lock
--    every writer of the credit pool takes first: migrations 527, 603, 654,
--    656), then reads the subscription, and answers:
--      - not_claimable: no such subscription of this account, an ended one
--        (canceled, expired, incomplete_expired), or one already granted. A
--        redelivered event for the granted subscription lands here, never
--        below.
--      - other_live, with that subscription's Stripe id: another subscription
--        of the same account, not ended, is either granted and live (active,
--        trialing, past_due, unpaid: LIVE_SUBSCRIPTION_STATUSES in
--        downgrade-floor.ts) or claimed (plan_claimed_at set), whatever its
--        status. Nothing is written.
--      - claimed: the subscription is marked granted and its claim time
--        stamped; the caller grants it.
--
-- Service-role only. Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- then the grants restated.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_claimed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.subscriptions.plan_claimed_at IS
  'When the plan grant was claimed through claim_subscription_grant (migration 663). NULL before that, and again once a failed grant releases its claim. A claimed subscription that has not ended keeps every other subscription of the account from being claimed.';

CREATE OR REPLACE FUNCTION public.claim_subscription_grant(
  p_stripe_subscription_id text,
  p_user_id                uuid
) RETURNS TABLE (outcome text, other_stripe_subscription_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub   record;
  v_other text;
BEGIN
  IF p_stripe_subscription_id IS NULL OR p_user_id IS NULL THEN
    outcome := 'not_claimable';
    other_stripe_subscription_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- The account's lock: two claims for one account run one after the other.
  PERFORM 1 FROM profiles WHERE id = p_user_id FOR UPDATE;

  SELECT s.id, s.status, s.plan_granted
    INTO v_sub
    FROM subscriptions s
   WHERE s.stripe_subscription_id = p_stripe_subscription_id
     AND s.user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND
     OR v_sub.plan_granted IS TRUE
     OR v_sub.status IN ('canceled', 'expired', 'incomplete_expired') THEN
    outcome := 'not_claimable';
    other_stripe_subscription_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT s.stripe_subscription_id
    INTO v_other
    FROM subscriptions s
   WHERE s.user_id = p_user_id
     AND s.id <> v_sub.id
     AND s.status NOT IN ('canceled', 'expired', 'incomplete_expired')
     AND (
           (s.plan_granted IS TRUE AND s.status IN ('active', 'trialing', 'past_due', 'unpaid'))
        OR s.plan_claimed_at IS NOT NULL
         )
   ORDER BY s.created_at, s.id
   LIMIT 1;

  IF FOUND THEN
    outcome := 'other_live';
    other_stripe_subscription_id := v_other;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE subscriptions
     SET plan_granted = true,
         plan_claimed_at = now()
   WHERE id = v_sub.id
     AND plan_granted = false;

  outcome := 'claimed';
  other_stripe_subscription_id := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_subscription_grant(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_subscription_grant(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_subscription_grant(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscription_grant(text, uuid) TO service_role;

-- A new function: PostgREST caches the schema and answers "not found" until it
-- reloads (the lesson recorded in 366).
NOTIFY pgrst, 'reload schema';
