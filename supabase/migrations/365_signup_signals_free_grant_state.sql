-- Free-credit abuse gate, PR 1 of 2: create the decision point, change no behaviour.
--
-- WHERE THE GRANT LIVES TODAY. `handle_new_user()` (migration 001) inserts a
-- profile naming four columns, so the 1,500-credit signup grant comes entirely
-- from a column default that 295 last repaired. There is no application code in
-- the path at all: no record of WHO was granted, no signal about the device or
-- network the account was created from, and therefore nothing to decide with.
--
-- WHAT THIS MIGRATION ADDS. A per-profile state (`free_grant_state`), a
-- service-role-only table of hashed signup signals, and one guarded RPC that
-- moves a row from 'unclaimed' to 'granted' while topping the balance up. PR 2
-- lowers the column default to zero and turns scoring on; until then the RPC's
-- GREATEST() is a no-op on a fresh profile and every unclaimed row is granted
-- unconditionally. Writing the top-up now — rather than with the scoring — is
-- what makes PR 2's migrate-then-deploy window safe: a signup landing between
-- the two can never be stranded at zero credits.
--
-- 'withheld' exists in the CHECK from day one so PR 2 needs no second ALTER; PR
-- 1 never writes it.
--
-- NOT IN THIS FILE, deliberately: the signup default itself (PR 2's lever) and
-- `handle_new_user()`, which is untouched — the new column's own default
-- applies to every fresh signup without it.

-- ---------------------------------------------------------------------------
-- 1. profiles.free_grant_state
--
-- BACKFILL, and why it is mandatory rather than tidy: every profile that
-- already exists received its 1,500 from the old column default. Left at the
-- 'unclaimed' default, each of them would claim a SECOND grant the first time
-- its owner opened the app after PR 2 — including every dormant account that
-- already spent the first one. So the backfill is the whole point of shipping
-- the column before the enforcement.
--
-- DISABLE/ENABLE TRIGGER: `profiles` carries `set_updated_at` from 001, whose
-- function assigns NEW.updated_at = NOW() unconditionally. An unguarded bulk
-- UPDATE would stamp every profile in the database with this migration's
-- timestamp and the original values are not recoverable. Same bracket as
-- 337_orgs_content_triggers.sql; safe because the migration runner wraps this
-- file in one transaction, so no other session sees the trigger off and a
-- failure rolls the DISABLE back with everything else.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_grant_state text NOT NULL DEFAULT 'unclaimed'
  CHECK (free_grant_state IN ('unclaimed', 'granted', 'withheld'));

ALTER TABLE profiles DISABLE TRIGGER set_updated_at;

UPDATE public.profiles SET free_grant_state = 'granted';

ALTER TABLE profiles ENABLE TRIGGER set_updated_at;

-- ---------------------------------------------------------------------------
-- 2. signup_signals — what the account looked like when it claimed.
--
-- HASHES ONLY. `browser_key` and `device_key` are SHA-256 hex digests computed
-- in the browser; `ip_hash` is derived SERVER-side from the first
-- X-Forwarded-For hop and never from the request body. Nothing here can be read
-- back into a raw fingerprint, an IP, or a user agent — the row outlives the
-- request by design, and an IP is personal data.
--
-- One row per (user_id, source): the claim endpoint upserts with
-- ON CONFLICT DO NOTHING, so a client that retries on every boot writes the
-- FIRST observation and never overwrites it with a later, cleaner one.
--
-- RLS on with ZERO policies, plus the table revoked from anon/authenticated.
-- Service role only: a policy here would be a lookup oracle over other people's
-- devices ("does anyone else share my device_key?"), and the scoring in PR 2
-- runs entirely server-side.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signup_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  browser_key text,
  device_key text,
  ip_hash text NOT NULL,
  source text NOT NULL DEFAULT 'claim',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source)
);

-- The three axes PR 2 counts collisions on.
CREATE INDEX IF NOT EXISTS idx_signup_signals_browser_key ON public.signup_signals (browser_key);
CREATE INDEX IF NOT EXISTS idx_signup_signals_device_key ON public.signup_signals (device_key);
CREATE INDEX IF NOT EXISTS idx_signup_signals_ip_hash ON public.signup_signals (ip_hash);

ALTER TABLE public.signup_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.signup_signals FROM anon;
REVOKE ALL ON public.signup_signals FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. credit_transactions.source admits the grant.
--
-- Drop-and-re-add with the FULL list (351's list plus one value) — 351's own
-- comment explains why: adding values one at a time is how a CHECK ends up
-- describing half of what it admits.
--
-- 'signup_grant' rather than reusing 'subscription_created': the ledger is
-- user-visible (/v1/billing/transactions, the MCP credit_transactions tool) and
-- admin-audited, there is no subscription behind this row, and a wrong source
-- is unfixable once written at scale.
-- ---------------------------------------------------------------------------
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IN (
    'subscription_created', 'subscription_renewal', 'one_time_purchase', 'admin_adjustment',
    'usage', 'refund', 'paddle_refund', 'expiry',
    'app_markup', 'app_earnings',
    'stripe_refund',
    'org_purchase', 'org_admin_grant', 'org_allocation', 'org_reclaim',
    'org_usage', 'org_refund', 'org_usage_variance',
    'signup_grant',
    -- Legacy values that may exist in older rows
    'purchase', 'subscription', 'admin', 'renewal', 'topup', 'adjustment'
  ));

-- ---------------------------------------------------------------------------
-- 4. claim_signup_grant — the guarded transition.
--
-- ONE UPDATE does everything: the `free_grant_state = 'unclaimed'` predicate IS
-- the lock. Two concurrent claims cannot both match it — the second blocks on
-- the row, re-evaluates against the committed version, and matches nothing — so
-- exactly one caller ever sees did_claim = true.
--
-- GREATEST rather than an assignment: a top-up, never a reset. A user who
-- somehow holds more than the grant (a purchase that raced the claim) keeps it.
--
-- The `FROM public.profiles AS prior` self-join is how the statement returns
-- the value from BEFORE the update: that scan runs on the statement snapshot,
-- so `prior.subscription_credits` is the old balance and `p.subscription_credits`
-- the new one. The caller writes a ledger row only when they differ — which,
-- while the old signup default still stands, is never.
--
-- When nothing matched, report the state that IS there, so the endpoint can
-- pass 'granted' (a race) or 'withheld' (PR 2) straight through.
--
-- SECURITY CRITICAL — the REVOKEs below are not boilerplate. Postgres grants
-- EXECUTE to PUBLIC on every new function, and PostgREST publishes public-schema
-- functions at /rest/v1/rpc/. Without them, `claim_signup_grant(p_user_id,
-- p_grant_amount)` is a self-serve credit mint any logged-in user could call
-- with any amount. Service role keeps EXECUTE through its OWN default-privilege
-- grant — each role holds a separate grant, which is why anon and authenticated
-- have to be named individually. There is no GRANT back to authenticated, ever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_signup_grant(p_user_id uuid, p_grant_amount integer)
RETURNS TABLE (did_claim boolean, old_credits integer, new_credits integer, state text)
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
     AND p.free_grant_state = 'unclaimed'
  RETURNING true, prior.subscription_credits, p.subscription_credits, p.free_grant_state
    INTO did_claim, old_credits, new_credits, state;

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

REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_signup_grant(uuid, integer) FROM authenticated;
