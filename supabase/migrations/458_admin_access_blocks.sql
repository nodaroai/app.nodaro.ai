-- 458_admin_access_blocks.sql
--
-- Admin access controls: take back an account's free signup credits, block an
-- account, block a network. The enforcement lives in the backend
-- (lib/access-blocks.ts reads the two block tables); this migration only adds
-- the state and the two money-moving functions.
--
-- Every table here is RLS-on with NO policies and revoked from anon and
-- authenticated: only the service role reads or writes them. A policy on any of
-- them would be an oracle ("is my network blocked? is that account?").
--
-- Idempotent: CI re-applies the newest migration.

-- ---------------------------------------------------------------------------
-- 1. account_blocks — one row per blocked account. Unblocking deletes the row;
--    the history lives in admin_actions (migration 102).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_blocks (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_blocks FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. blocked_networks — a network is either a hashed network key (an account's
--    signup network, never shown raw) or a range an admin typed. Every block
--    expires: addresses move between people.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_hash text UNIQUE CHECK (network_hash IS NULL OR network_hash ~ '^[0-9a-f]{64}$'),
  cidr cidr UNIQUE,
  label text CHECK (label IS NULL OR char_length(label) <= 200),
  source_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Set when only a super admin could place this block (a busy or paying
  -- network, a range wider than one address): only a super admin lifts it.
  super_admin_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT blocked_networks_one_target CHECK ((network_hash IS NULL) <> (cidr IS NULL)),
  CONSTRAINT blocked_networks_expires_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS blocked_networks_expires_idx ON public.blocked_networks (expires_at);

ALTER TABLE public.blocked_networks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocked_networks FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. free_grant_revocations — what a take-back removed, so a restore puts back
--    exactly that and returns the account to the state it was taken from.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.free_grant_revocations (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  removed_credits integer NOT NULL CHECK (removed_credits >= 0),
  previous_state text NOT NULL CHECK (previous_state IN ('granted', 'withheld')),
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.free_grant_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_grant_revocations FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. signup_signals.ip_scheme — 'client' when ip_hash is the hash of a real
--    client network. NULL for rows written before the backend read real
--    addresses (they hold a hosting proxy's hash) and for an unknown address.
--    Only 'client' rows may become a network block.
-- ---------------------------------------------------------------------------
ALTER TABLE public.signup_signals
  ADD COLUMN IF NOT EXISTS ip_scheme text CHECK (ip_scheme IS NULL OR ip_scheme = 'client');

-- ---------------------------------------------------------------------------
-- 5. free_grant_state gains 'revoked': taken back by an admin. Not claimable
--    (claim_signup_grant requires 'unclaimed') and not activatable by a card
--    (activate_signup_grant requires 'withheld') — only an admin restores it.
--    365 created the CHECK unnamed; find it by what it checks, not by a name.
--    A re-apply finds it already widened and leaves the table alone: swapping
--    the CHECK locks profiles for a full scan.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%free_grant_state%'
       AND pg_get_constraintdef(oid) ILIKE '%revoked%'
  ) THEN
    RETURN;
  END IF;

  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%free_grant_state%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_free_grant_state_check
    CHECK (free_grant_state IN ('unclaimed', 'granted', 'withheld', 'revoked'));
END $$;

-- ---------------------------------------------------------------------------
-- 6. revoke_signup_grant — 'granted' | 'withheld' → 'revoked'.
--
-- Takes back what is left of the free grant: LEAST(subscription_credits,
-- grant) for a granted account, nothing for a withheld one (it never got it;
-- the point there is that its owner can no longer activate it with a card).
-- Purchased top-ups are never touched.
--
-- Refused, moving nothing:
--   not_found        — no such account
--   not_revocable    — not 'granted' or 'withheld'
--   paid_account     — a paid tier, or any subscription ever: a subscriber's
--                      free leftover was folded into top-up at subscribe time
--                      and cannot be told apart from money they paid
--   reservations_open — a reservation that can still settle is open: its
--                      refund (or a commit refunding a surplus) would hand
--                      credits back after the take-back. That is any
--                      reservation from the last 7 days, and any — however
--                      old — whose job is still running or held for review.
--                      Older ones on finished jobs are leftovers that never
--                      settle, and must not refuse the take-back for ever.
--
-- The profile row lock (FOR UPDATE) serialises this against reserve_credits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_signup_grant(p_user_id uuid, p_grant_amount integer, p_admin_id uuid)
RETURNS TABLE (did_revoke boolean, old_credits integer, new_credits integer, state text, refusal text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text;
  v_credits integer;
  v_tier text;
  v_removed integer;
BEGIN
  IF p_grant_amount IS NULL OR p_grant_amount <= 0 THEN
    RAISE EXCEPTION 'revoke_signup_grant: grant amount must be positive, got %', p_grant_amount;
  END IF;

  SELECT p.free_grant_state, COALESCE(p.subscription_credits, 0), COALESCE(p.tier, p.subscription_tier, 'free')
    INTO v_state, v_credits, v_tier
    FROM public.profiles AS p
   WHERE p.id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::integer, NULL::integer, NULL::text, 'not_found'::text;
    RETURN;
  END IF;

  IF v_state NOT IN ('granted', 'withheld') THEN
    RETURN QUERY SELECT false, v_credits, v_credits, v_state, 'not_revocable'::text;
    RETURN;
  END IF;

  IF v_tier <> 'free' OR EXISTS (SELECT 1 FROM public.subscriptions AS s WHERE s.user_id = p_user_id) THEN
    RETURN QUERY SELECT false, v_credits, v_credits, v_state, 'paid_account'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.usage_logs AS u
      LEFT JOIN public.jobs AS j ON j.id = u.job_id
     WHERE u.user_id = p_user_id
       AND u.status = 'reserved'
       AND (
         u.created_at > now() - interval '7 days'
         OR (j.id IS NOT NULL AND j.status NOT IN ('completed', 'failed', 'cancelled'))
       )
  ) THEN
    RETURN QUERY SELECT false, v_credits, v_credits, v_state, 'reservations_open'::text;
    RETURN;
  END IF;

  v_removed := CASE WHEN v_state = 'granted' THEN LEAST(GREATEST(v_credits, 0), p_grant_amount) ELSE 0 END;

  UPDATE public.profiles AS p
     SET subscription_credits = v_credits - v_removed,
         free_grant_state = 'revoked'
   WHERE p.id = p_user_id;

  INSERT INTO public.free_grant_revocations AS r (user_id, removed_credits, previous_state, revoked_by, revoked_at)
  VALUES (p_user_id, v_removed, v_state, p_admin_id, now())
  ON CONFLICT (user_id) DO UPDATE
     SET removed_credits = EXCLUDED.removed_credits,
         previous_state = EXCLUDED.previous_state,
         revoked_by = EXCLUDED.revoked_by,
         revoked_at = EXCLUDED.revoked_at;

  RETURN QUERY SELECT true, v_credits, v_credits - v_removed, 'revoked'::text, NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_signup_grant(uuid, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_signup_grant(uuid, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_signup_grant(uuid, integer, uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 7. reinstate_signup_grant — 'revoked' → the state it was taken from, with
--    exactly the credits the take-back removed. Refused (moving nothing) when
--    the account is not 'revoked' or has become a paid account since.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reinstate_signup_grant(p_user_id uuid)
RETURNS TABLE (did_reinstate boolean, old_credits integer, new_credits integer, state text, refusal text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text;
  v_credits integer;
  v_tier text;
  v_removed integer;
  v_previous text;
BEGIN
  SELECT p.free_grant_state, COALESCE(p.subscription_credits, 0), COALESCE(p.tier, p.subscription_tier, 'free')
    INTO v_state, v_credits, v_tier
    FROM public.profiles AS p
   WHERE p.id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::integer, NULL::integer, NULL::text, 'not_found'::text;
    RETURN;
  END IF;

  IF v_state IS DISTINCT FROM 'revoked' THEN
    RETURN QUERY SELECT false, v_credits, v_credits, v_state, 'not_revoked'::text;
    RETURN;
  END IF;

  IF v_tier <> 'free' OR EXISTS (SELECT 1 FROM public.subscriptions AS s WHERE s.user_id = p_user_id) THEN
    RETURN QUERY SELECT false, v_credits, v_credits, v_state, 'paid_account'::text;
    RETURN;
  END IF;

  SELECT r.removed_credits, r.previous_state
    INTO v_removed, v_previous
    FROM public.free_grant_revocations AS r
   WHERE r.user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    v_removed := 0;
    v_previous := 'granted';
  END IF;

  UPDATE public.profiles AS p
     SET subscription_credits = v_credits + v_removed,
         free_grant_state = v_previous
   WHERE p.id = p_user_id;

  DELETE FROM public.free_grant_revocations AS r WHERE r.user_id = p_user_id;

  RETURN QUERY SELECT true, v_credits, v_credits + v_removed, v_previous, NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reinstate_signup_grant(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reinstate_signup_grant(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reinstate_signup_grant(uuid) FROM authenticated;

NOTIFY pgrst, 'reload schema';
