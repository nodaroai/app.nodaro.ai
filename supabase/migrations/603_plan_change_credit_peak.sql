-- ============================================================================
-- 603 — Plan upgrades grant credits once per credit period, and only when paid
-- ============================================================================
-- WHAT CHANGES. Moving a subscription to a higher plan used to SET the
-- subscription pool to the new plan's full monthly amount, at the moment of
-- the change and again when Stripe's subscription.updated event arrived.
-- Nothing was paid at that moment (the price difference was left for the
-- next invoice), and a downgrade followed by an upgrade inside one period
-- refilled the pool each time.
--
-- From this file on:
--   * An upgrade is invoiced at once and the new plan applies only when that
--     invoice is paid (backend/src/ee/routes/billing.ts).
--   * The paid invoice ADDS credits: the gap between the plan already held
--     this period and the new plan, never the full amount. One RPC,
--     `grant_plan_change_credits`, keyed by the Stripe invoice id, so a
--     replayed or late webhook and the route that saw the payment first
--     grant exactly once between them.
--   * Each credit period remembers the highest plan amount it has granted
--     (`plan_credit_periods.peak_credits`). Moving down and back up inside
--     the same period grants nothing beyond that peak.
--
-- THE CREDIT PERIOD is the one `profiles.credits_reset_at` already marks:
-- every writer that grants a period's credits (subscription created, the
-- renewal, its hourly safety net, and 527's monthly grant on yearly plans)
-- SETs the pool AND stamps that column in one statement. A trigger records
-- the amount each of those resets granted as the new period's peak, so no
-- writer has to know this table exists. `credits_reset_at` is already on the
-- profiles UPDATE denylist (527): an owner cannot rewind it from a browser.
--
-- A downgrade moves no credits (unused credits stay until the period ends);
-- `note_plan_credit_peak` records the plan the account is leaving, so a
-- period whose reset predates this file is covered too.
--
-- A switch between monthly and yearly billing restarts Stripe's billing
-- period part-way through the current one. That is not a renewal: the
-- current period has already granted its credits, so
-- `restart_plan_credit_period` starts the new period WITHOUT a grant. It
-- stamps `credits_reset_at` (so the yearly plan's monthly grant does not
-- treat the new period's first day as unpaid) and carries the peak over, so
-- the switch, and a switch back, grants nothing until the next real renewal
-- or monthly grant.
--
-- Everything here is service-role only: the table has RLS with no policies,
-- and every function is revoked from PUBLIC, anon and authenticated.
--
-- IDEMPOTENT ON A SECOND APPLY: IF NOT EXISTS for the table, CREATE OR
-- REPLACE for the functions, DROP TRIGGER IF EXISTS before CREATE TRIGGER.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. One row per account: the credit period it describes and its peak.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_credit_periods (
  user_id          uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The profiles.credits_reset_at value of the period this row describes.
  -- A row whose value differs from the profile's describes an earlier
  -- period and counts as no peak at all.
  period_reset_at  timestamptz,
  peak_credits     integer NOT NULL DEFAULT 0 CHECK (peak_credits >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_credit_periods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.plan_credit_periods FROM PUBLIC;
REVOKE ALL ON public.plan_credit_periods FROM anon;
REVOKE ALL ON public.plan_credit_periods FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_credit_periods TO service_role;

-- ---------------------------------------------------------------------------
-- 2. A period reset records what it granted as the new period's peak.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_credit_period_on_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO plan_credit_periods (user_id, period_reset_at, peak_credits, updated_at)
  VALUES (NEW.id, NEW.credits_reset_at, GREATEST(COALESCE(NEW.subscription_credits, 0), 0), now())
  ON CONFLICT (user_id) DO UPDATE
    SET period_reset_at = EXCLUDED.period_reset_at,
        peak_credits    = EXCLUDED.peak_credits,
        updated_at      = now();
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.plan_credit_period_on_reset() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plan_credit_period_on_reset() FROM anon;
REVOKE ALL ON FUNCTION public.plan_credit_period_on_reset() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.plan_credit_period_on_reset() TO service_role;

DROP TRIGGER IF EXISTS plan_credit_period_on_reset ON public.profiles;
CREATE TRIGGER plan_credit_period_on_reset
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (NEW.credits_reset_at IS DISTINCT FROM OLD.credits_reset_at)
  EXECUTE FUNCTION public.plan_credit_period_on_reset();

-- ---------------------------------------------------------------------------
-- 3. note_plan_credit_peak — raise the current period's peak to at least
--    p_credits (a plan the account held this period). Returns the peak.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.note_plan_credit_peak(
  p_user_id uuid,
  p_credits integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset timestamptz;
  v_peak  integer;
BEGIN
  IF p_credits IS NULL OR p_credits < 0 THEN
    RAISE EXCEPTION 'note_plan_credit_peak: credits must be zero or more, got %', p_credits;
  END IF;

  -- The profile's row lock orders this against a reset and a grant.
  SELECT credits_reset_at INTO v_reset FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'note_plan_credit_peak: profile % not found', p_user_id;
  END IF;

  INSERT INTO plan_credit_periods AS p (user_id, period_reset_at, peak_credits, updated_at)
  VALUES (p_user_id, v_reset, p_credits, now())
  ON CONFLICT (user_id) DO UPDATE
    SET peak_credits = CASE
          WHEN p.period_reset_at IS NOT DISTINCT FROM EXCLUDED.period_reset_at
            THEN GREATEST(p.peak_credits, EXCLUDED.peak_credits)
          ELSE EXCLUDED.peak_credits
        END,
        period_reset_at = EXCLUDED.period_reset_at,
        updated_at      = now()
  RETURNING p.peak_credits INTO v_peak;

  RETURN v_peak;
END;
$$;

REVOKE ALL ON FUNCTION public.note_plan_credit_peak(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.note_plan_credit_peak(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.note_plan_credit_peak(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.note_plan_credit_peak(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. grant_plan_change_credits — the paid plan-change invoice's grant.
--
--    p_from_credits: the plan amount the account is moving from (the
--                    highest plan the invoice credits back).
--    p_to_credits:   the plan amount it is moving to (the highest plan the
--                    invoice charges for).
--
--    gap = max(0, p_to_credits - max(this period's peak, p_from_credits)),
--    added to subscription_credits. The transactions row keyed by the
--    invoice id is the claim: a second call for the same invoice returns
--    claimed = false and changes nothing. Claim, peak, pool and ledger row
--    commit together or not at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_plan_change_credits(
  p_user_id      uuid,
  p_invoice_id   text,
  p_from_credits integer,
  p_to_credits   integer,
  p_amount_usd   numeric,
  p_tier         text
) RETURNS TABLE (claimed boolean, granted_credits integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset   timestamptz;
  v_peak    integer;
  v_base    integer;
  v_gap     integer;
  v_rows    integer;
  v_balance integer;
BEGIN
  IF p_invoice_id IS NULL OR length(p_invoice_id) = 0 THEN
    RAISE EXCEPTION 'grant_plan_change_credits: an invoice id is required';
  END IF;
  IF p_to_credits IS NULL OR p_to_credits < 0 OR COALESCE(p_from_credits, 0) < 0 THEN
    RAISE EXCEPTION 'grant_plan_change_credits: credits must be zero or more (from %, to %)', p_from_credits, p_to_credits;
  END IF;

  -- Lock the profile first: a reset, a downgrade's note and another grant
  -- all wait here, so the period and its peak cannot move underneath.
  SELECT credits_reset_at INTO v_reset FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_plan_change_credits: profile % not found', p_user_id;
  END IF;

  SELECT pcp.peak_credits INTO v_peak
    FROM plan_credit_periods pcp
   WHERE pcp.user_id = p_user_id
     AND pcp.period_reset_at IS NOT DISTINCT FROM v_reset;

  v_base := GREATEST(COALESCE(v_peak, 0), COALESCE(p_from_credits, 0));
  v_gap  := GREATEST(0, p_to_credits - v_base);

  -- The claim. A replay finds the row and stops here.
  INSERT INTO transactions (user_id, stripe_transaction_id, type, amount_usd, credits_granted, tier)
  VALUES (p_user_id, p_invoice_id, 'subscription', COALESCE(p_amount_usd, 0), v_gap, p_tier)
  ON CONFLICT (stripe_transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  INSERT INTO plan_credit_periods AS p (user_id, period_reset_at, peak_credits, updated_at)
  VALUES (p_user_id, v_reset, GREATEST(v_base, p_to_credits), now())
  ON CONFLICT (user_id) DO UPDATE
    SET period_reset_at = EXCLUDED.period_reset_at,
        peak_credits    = EXCLUDED.peak_credits,
        updated_at      = now();

  IF v_gap > 0 THEN
    UPDATE profiles
       SET subscription_credits = subscription_credits + v_gap
     WHERE id = p_user_id
    RETURNING subscription_credits INTO v_balance;

    INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, balance_after)
    VALUES (
      p_user_id, v_gap, 'subscription', 'subscription_renewal',
      format('Plan upgrade to %s: +%s credits for the rest of this period', COALESCE(p_tier, 'a higher plan'), v_gap),
      v_balance
    );
  END IF;

  RETURN QUERY SELECT true, v_gap;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_plan_change_credits(uuid, text, integer, integer, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_plan_change_credits(uuid, text, integer, integer, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.grant_plan_change_credits(uuid, text, integer, integer, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_plan_change_credits(uuid, text, integer, integer, numeric, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. restart_plan_credit_period — Stripe restarted the billing period part-way
--    through (a monthly <-> yearly switch). Starts a new credit period with no
--    grant: the pool is untouched, credits_reset_at moves to now(), and the
--    new period's peak is the old period's peak (at least p_held_credits, the
--    plan held when the switch happened). Returns that peak.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restart_plan_credit_period(
  p_user_id      uuid,
  p_held_credits integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reset     timestamptz;
  v_new_reset timestamptz;
  v_peak      integer;
BEGIN
  IF p_held_credits IS NULL OR p_held_credits < 0 THEN
    RAISE EXCEPTION 'restart_plan_credit_period: credits must be zero or more, got %', p_held_credits;
  END IF;

  SELECT credits_reset_at INTO v_reset FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restart_plan_credit_period: profile % not found', p_user_id;
  END IF;

  SELECT pcp.peak_credits INTO v_peak
    FROM plan_credit_periods pcp
   WHERE pcp.user_id = p_user_id
     AND pcp.period_reset_at IS NOT DISTINCT FROM v_reset;
  v_peak := GREATEST(COALESCE(v_peak, 0), p_held_credits);

  -- The stamp only: subscription_credits is not written. The reset trigger
  -- fires here and seeds the new period from the pool; the carried peak
  -- replaces that seed just below, in the same transaction.
  UPDATE profiles SET credits_reset_at = now() WHERE id = p_user_id
  RETURNING credits_reset_at INTO v_new_reset;

  INSERT INTO plan_credit_periods (user_id, period_reset_at, peak_credits, updated_at)
  VALUES (p_user_id, v_new_reset, v_peak, now())
  ON CONFLICT (user_id) DO UPDATE
    SET period_reset_at = EXCLUDED.period_reset_at,
        peak_credits    = EXCLUDED.peak_credits,
        updated_at      = now();

  RETURN v_peak;
END;
$$;

REVOKE ALL ON FUNCTION public.restart_plan_credit_period(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restart_plan_credit_period(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.restart_plan_credit_period(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.restart_plan_credit_period(uuid, integer) TO service_role;
