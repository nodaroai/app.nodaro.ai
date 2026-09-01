-- ============================================================================
-- Behavioral proof: the free signup grant is claim-delivered, service-role
-- only, and one card activates one account (migrations 365 + 366).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000921 upward).
--
-- WHY THIS PROOF EXISTS. The 1,500-credit signup grant used to be a column
-- DEFAULT, paid before any code ran. 366 moves it into two SECURITY DEFINER
-- RPCs whose only protection is a set of REVOKEs and a state predicate. The
-- text guards in backend/src/__tests__ pin the SQL; this file pins what the
-- database actually DOES: a fresh profile opens at zero, a signed-in user
-- cannot call either RPC, cannot read the signal tables, cannot flip their
-- own state, a second claim is a no-op, a withhold moves no credits, and the
-- card index refuses a second account. Every one of these is a credit mint if
-- it regresses.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/free-grant.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- Two fresh signups (the auth trigger creates the profiles) and one
-- pre-existing account that 365's backfill would have marked granted.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000921', 'fg-new1@fg.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000922', 'fg-new2@fg.test', '{}', 'authenticated', 'authenticated');

-- 0. A fresh profile opens at ZERO and unclaimed — the column no longer pays.
SELECT pg_temp.assert_eq('a fresh profile opens with 0 subscription_credits',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000921'), '0');
SELECT pg_temp.assert_eq('a fresh profile is unclaimed',
  (SELECT free_grant_state FROM profiles WHERE id = '00000000-0000-4000-8000-000000000921'), 'unclaimed');

-- 1. The claim (service role): grants exactly once, tops up to the amount.
SELECT pg_temp.assert_eq('first claim grants',
  (SELECT did_claim::text FROM claim_signup_grant('00000000-0000-4000-8000-000000000921', 1500)), 'true');
SELECT pg_temp.assert_eq('balance after the claim is the grant',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000921'), '1500');
SELECT pg_temp.assert_eq('a second claim is a no-op (did_claim false)',
  (SELECT did_claim::text FROM claim_signup_grant('00000000-0000-4000-8000-000000000921', 1500)), 'false');
SELECT pg_temp.assert_eq('a second claim reports the settled state',
  (SELECT state FROM claim_signup_grant('00000000-0000-4000-8000-000000000921', 1500)), 'granted');
SELECT pg_temp.assert_eq('a second claim does not move the balance',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000921'), '1500');
-- GREATEST is a top-up, never a reset: a balance above the grant survives.
UPDATE profiles SET free_grant_state = 'unclaimed', subscription_credits = 2000
  WHERE id = '00000000-0000-4000-8000-000000000921';
SELECT pg_temp.assert_eq('the claim never lowers a balance',
  (SELECT new_credits::text FROM claim_signup_grant('00000000-0000-4000-8000-000000000921', 1500)), '2000');
UPDATE profiles SET subscription_credits = 1500 WHERE id = '00000000-0000-4000-8000-000000000921';

-- 2. The withhold (service role): state moves, credits do not, did_claim false.
SELECT pg_temp.assert_eq('a withhold reports did_claim false',
  (SELECT did_claim::text FROM claim_signup_grant('00000000-0000-4000-8000-000000000922', 1500, true)), 'false');
SELECT pg_temp.assert_eq('a withhold sets the state',
  (SELECT free_grant_state FROM profiles WHERE id = '00000000-0000-4000-8000-000000000922'), 'withheld');
SELECT pg_temp.assert_eq('a withhold moves no credits',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000922'), '0');
SELECT pg_temp.assert_eq('a claim after a withhold cannot grant (the lock is the unclaimed predicate)',
  (SELECT did_claim::text FROM claim_signup_grant('00000000-0000-4000-8000-000000000922', 1500)), 'false');
SELECT pg_temp.assert_eq('...and still moves no credits',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000922'), '0');

-- 3. THE HOLE the REVOKEs close: a signed-in user cannot call either RPC.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000922","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000922';
DO $$ BEGIN
  PERFORM claim_signup_grant('00000000-0000-4000-8000-000000000922', 999999);
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could EXECUTE claim_signup_grant';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot EXECUTE claim_signup_grant';
END $$;
DO $$ BEGIN
  PERFORM activate_signup_grant('00000000-0000-4000-8000-000000000922', 999999);
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could EXECUTE activate_signup_grant';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot EXECUTE activate_signup_grant';
END $$;

-- 4. ...cannot read the signal tables (a device-collision oracle otherwise)...
DO $$ BEGIN
  PERFORM count(*) FROM signup_signals;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could SELECT signup_signals';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot SELECT signup_signals';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM free_grant_activations;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could SELECT free_grant_activations';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot SELECT free_grant_activations';
END $$;

-- 5. ...and cannot reset their own state to re-claim (the profiles denylist).
--    RLS's WITH CHECK refuses the row, which surfaces as an error.
DO $$ BEGIN
  UPDATE profiles SET free_grant_state = 'unclaimed' WHERE id = '00000000-0000-4000-8000-000000000922';
  IF (SELECT free_grant_state FROM profiles WHERE id = '00000000-0000-4000-8000-000000000922') = 'unclaimed' THEN
    RAISE EXCEPTION 'ASSERT FAIL: a user reset their own free_grant_state';
  END IF;
  RAISE NOTICE 'ok  a user cannot reset their own free_grant_state (row unchanged)';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'ok  a user cannot reset their own free_grant_state (refused)';
END $$;
DO $$ BEGIN
  UPDATE profiles SET subscription_credits = 999999 WHERE id = '00000000-0000-4000-8000-000000000922';
  IF (SELECT subscription_credits FROM profiles WHERE id = '00000000-0000-4000-8000-000000000922') = 999999 THEN
    RAISE EXCEPTION 'ASSERT FAIL: a user wrote their own subscription_credits';
  END IF;
  RAISE NOTICE 'ok  a user cannot write their own subscription_credits (row unchanged)';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'ok  a user cannot write their own subscription_credits (refused)';
END $$;
RESET ROLE;

-- 6. One card, one grant. The first activation lands; the same card on the
--    other account is refused by the index; the activation RPC then pays the
--    withheld account exactly once.
INSERT INTO free_grant_activations (user_id, card_fingerprint_hash)
  VALUES ('00000000-0000-4000-8000-000000000921', repeat('c', 64));
DO $$ BEGIN
  INSERT INTO free_grant_activations (user_id, card_fingerprint_hash)
    VALUES ('00000000-0000-4000-8000-000000000922', repeat('c', 64));
  RAISE EXCEPTION 'ASSERT FAIL: the same card activated a second account';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok  the same card cannot activate a second account';
END $$;
SELECT pg_temp.assert_eq('activation grants a withheld account',
  (SELECT did_activate::text FROM activate_signup_grant('00000000-0000-4000-8000-000000000922', 1500)), 'true');
SELECT pg_temp.assert_eq('activation pays the grant',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000922'), '1500');
SELECT pg_temp.assert_eq('a second activation is a no-op',
  (SELECT did_activate::text FROM activate_signup_grant('00000000-0000-4000-8000-000000000922', 1500)), 'false');
SELECT pg_temp.assert_eq('activation of a GRANTED account is a no-op (wrong source state)',
  (SELECT did_activate::text FROM activate_signup_grant('00000000-0000-4000-8000-000000000921', 1500)), 'false');

-- 7. Deleting the account does not free the card.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000921';
SELECT pg_temp.assert_eq('the card row survives account deletion',
  (SELECT count(*)::text FROM free_grant_activations WHERE card_fingerprint_hash = repeat('c', 64)), '1');
SELECT pg_temp.assert_eq('...with its user detached',
  (SELECT (user_id IS NULL)::text FROM free_grant_activations WHERE card_fingerprint_hash = repeat('c', 64)), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
