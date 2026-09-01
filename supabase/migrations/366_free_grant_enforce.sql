-- Free-credit abuse gate, PR 2 of 2: enforcement.
--
-- 365 created the decision point (free_grant_state, signup_signals, the guarded
-- claim RPC) while the column default kept paying every signup 1,500 credits
-- before any code ran. This file moves the grant out of the default and into
-- that decision point, and gives the decision a second outcome.
--
-- WHAT CHANGES FOR A NEW SIGNUP. handle_new_user() still inserts the profile
-- without naming subscription_credits, so a fresh row now opens at 0 with
-- free_grant_state = 'unclaimed'. The claim endpoint (boot-time, plus the
-- server-side fallback on the balance read) then either tops the balance up to
-- TIER_CREDITS.free ('granted') or leaves it at zero ('withheld'). Every
-- pre-existing profile was backfilled to 'granted' by 365, so nothing here can
-- touch an account that already has its grant.
--
-- THE MIGRATE/DEPLOY WINDOW. Migrations reach the database from the migrate
-- job on a push to main; the deploy follows. Between the two, PR 1's code is
-- still serving against this default — and its claim already tops the balance
-- up (GREATEST), so a signup landing in that window is granted rather than
-- stranded at zero. That is the window 365's comment promised to make safe.

-- ---------------------------------------------------------------------------
-- 1. The lever. New profiles open at zero; the grant is now the RPC's job.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ALTER COLUMN subscription_credits SET DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. The decision, recorded next to the signals it was made from.
--
-- `decision` mirrors the profile state the claim wrote; `reasons` is the list
-- of rules that fired ('email_only_provider', 'browser_match', ...). Admin
-- review reads these — the operator restoring a grant needs to see WHY it was
-- withheld, and the profile row alone cannot say.
-- ---------------------------------------------------------------------------
ALTER TABLE public.signup_signals
  ADD COLUMN IF NOT EXISTS decision text
    CHECK (decision IS NULL OR decision IN ('granted', 'withheld')),
  ADD COLUMN IF NOT EXISTS reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. claim_signup_grant learns to withhold.
--
-- Same guarded UPDATE, same lock (the 'unclaimed' predicate), one more
-- argument. p_withhold = true moves the row to 'withheld' and leaves the
-- balance exactly where it is; did_claim is true ONLY for a grant, so the
-- caller's "write a ledger row" check cannot fire on a withhold.
--
-- The argument has a DEFAULT so the two-argument call PR 1's code makes keeps
-- resolving during the deploy window — PostgREST matches by named argument
-- and fills the default. Drop-and-recreate rather than CREATE OR REPLACE: the
-- signature changes, and an orphaned two-argument overload would be a second
-- function to remember to lock down.
--
-- REVOKEs restated: a new function gets EXECUTE for PUBLIC again.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_signup_grant(uuid, integer);

CREATE OR REPLACE FUNCTION public.claim_signup_grant(
  p_user_id uuid,
  p_grant_amount integer,
  p_withhold boolean DEFAULT false
)
RETURNS TABLE (did_claim boolean, old_credits integer, new_credits integer, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_withhold THEN
    UPDATE public.profiles AS p
       SET free_grant_state = 'withheld'
     WHERE p.id = p_user_id
       AND p.free_grant_state = 'unclaimed'
    RETURNING false, p.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_claim, old_credits, new_credits, state;
  ELSE
    UPDATE public.profiles AS p
       SET free_grant_state = 'granted',
           subscription_credits = GREATEST(p.subscription_credits, p_grant_amount)
      FROM public.profiles AS prior
     WHERE p.id = p_user_id
       AND prior.id = p.id
       AND p.free_grant_state = 'unclaimed'
    RETURNING true, prior.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_claim, old_credits, new_credits, state;
  END IF;

  IF NOT FOUND THEN
    SELECT false, p.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_claim, old_credits, new_credits, state
      FROM public.profiles AS p
     WHERE p.id = p_user_id;
  END IF;

  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer, boolean) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. activate_signup_grant — the way OUT of 'withheld'.
--
-- Two callers, both service-role: the card-activation endpoint (the user
-- proved a payment method the platform has not seen before) and the admin
-- restore action. Guarded exactly like the claim: the 'withheld' predicate is
-- the lock, GREATEST means a top-up and never a reset, did_activate is true
-- for exactly one caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_signup_grant(p_user_id uuid, p_grant_amount integer)
RETURNS TABLE (did_activate boolean, old_credits integer, new_credits integer, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.profiles AS p
     SET free_grant_state = 'granted',
         subscription_credits = GREATEST(p.subscription_credits, p_grant_amount)
    FROM public.profiles AS prior
   WHERE p.id = p_user_id
     AND prior.id = p.id
     AND p.free_grant_state = 'withheld'
  RETURNING true, prior.subscription_credits, p.subscription_credits, p.free_grant_state
    INTO did_activate, old_credits, new_credits, state;

  IF NOT FOUND THEN
    SELECT false, p.subscription_credits, p.subscription_credits, p.free_grant_state
      INTO did_activate, old_credits, new_credits, state
      FROM public.profiles AS p
     WHERE p.id = p_user_id;
  END IF;

  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_signup_grant(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_signup_grant(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_signup_grant(uuid, integer) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. free_grant_activations — one card, one grant.
--
-- A withheld account activates its grant by adding a payment method (a $0
-- SetupIntent; nothing is charged). Stripe's card fingerprint is the one
-- deterministic cross-account signal in the whole system, and it is only worth
-- collecting if it is ENFORCED: the UNIQUE index below is what makes a card
-- that already activated one account refuse to activate a second. Without it
-- one real card would unlock every farmed account — exactly the abuser the
-- withhold just caught.
--
-- Stored hashed (SHA-256 of Stripe's fingerprint), so the row is a uniqueness
-- token and nothing more.
--
-- ON DELETE SET NULL, NOT cascade: the account may go, the card's one use has
-- been spent. A cascade would let "delete the account, sign up again, re-add
-- the same card" reuse it.
--
-- Service-role only, same shape as signup_signals: RLS on, zero policies,
-- table revoked from the client roles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.free_grant_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  card_fingerprint_hash text NOT NULL,
  stripe_customer_id text,
  stripe_setup_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id),
  UNIQUE (card_fingerprint_hash)
);

ALTER TABLE public.free_grant_activations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.free_grant_activations FROM anon;
REVOKE ALL ON public.free_grant_activations FROM authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admin review needs "who is withheld" without a table scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_free_grant_withheld
  ON public.profiles (created_at DESC)
  WHERE free_grant_state = 'withheld';

-- ---------------------------------------------------------------------------
-- 7. claim_signup_grant changed signature. Supabase's DDL event trigger
-- reloads PostgREST on its own; this is the belt to that suspender, because a
-- stale cache would answer the three-argument call with "function not found"
-- for every claim until the next reload.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
