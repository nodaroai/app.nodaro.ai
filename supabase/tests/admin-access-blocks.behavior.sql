-- ============================================================================
-- Behavioral proof: admin access controls (migration 458).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000951 upward).
--
-- WHY THIS PROOF EXISTS. Taking back free credits moves money in two
-- SECURITY DEFINER functions whose only protection is a set of REVOKEs, a row
-- lock and a handful of refusals; the block tables are protected only by RLS
-- with no policies. Each assertion below is a credit mint, a lost refund, or a
-- block a user could read or lift themselves if it regresses.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/admin-access-blocks.behavior.sql mig-test:/tmp/t.sql
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000951', 'ab-granted@ab.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000952', 'ab-withheld@ab.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000953', 'ab-paid@ab.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000954', 'ab-subscribed@ab.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000955', 'ab-busy@ab.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000956', 'ab-extra@ab.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000957', 'ab-leftover@ab.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000958', 'ab-held@ab.test', '{}', 'authenticated', 'authenticated');

-- Granted account that has spent 400 of its 1,500; withheld account at 0; the
-- rest granted with untouched grants.
SELECT claim_signup_grant('00000000-0000-4000-8000-000000000951', 1500);
UPDATE profiles SET subscription_credits = 1100, topup_credits = 3300 WHERE id = '00000000-0000-4000-8000-000000000951';
SELECT claim_signup_grant('00000000-0000-4000-8000-000000000952', 1500, true);
SELECT claim_signup_grant(id, 1500) FROM profiles WHERE id IN (
  '00000000-0000-4000-8000-000000000953', '00000000-0000-4000-8000-000000000954',
  '00000000-0000-4000-8000-000000000955', '00000000-0000-4000-8000-000000000956',
  '00000000-0000-4000-8000-000000000957', '00000000-0000-4000-8000-000000000958');
UPDATE profiles SET tier = 'basic', subscription_tier = 'basic' WHERE id = '00000000-0000-4000-8000-000000000953';
INSERT INTO subscriptions (user_id, tier, status) VALUES ('00000000-0000-4000-8000-000000000954', 'basic', 'canceled');
INSERT INTO usage_logs (user_id, action, provider, credits_used, status)
  VALUES ('00000000-0000-4000-8000-000000000955', 'generate-image', 'kie', 50, 'reserved');
-- A reservation left over from a job that finished months ago (it never
-- settles), and an equally old one whose job is still held for review (it
-- still can: a reject refunds it).
INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-0000000009a7', '00000000-0000-4000-8000-000000000957', 'completed'),
  ('00000000-0000-4000-8000-0000000009a8', '00000000-0000-4000-8000-000000000958', 'pending_review');
INSERT INTO usage_logs (user_id, action, provider, credits_used, status, job_id, created_at) VALUES
  ('00000000-0000-4000-8000-000000000957', 'generate-image', 'kie', 50, 'reserved', '00000000-0000-4000-8000-0000000009a7', now() - interval '90 days'),
  ('00000000-0000-4000-8000-000000000958', 'generate-image', 'kie', 50, 'reserved', '00000000-0000-4000-8000-0000000009a8', now() - interval '90 days');
-- An admin added 500 on top of a full grant.
UPDATE profiles SET subscription_credits = 2000 WHERE id = '00000000-0000-4000-8000-000000000956';

-- 1. Take back from a granted account: what is left of the grant, never top-ups.
SELECT pg_temp.assert_eq('revoke takes back a granted account',
  (SELECT did_revoke::text FROM revoke_signup_grant('00000000-0000-4000-8000-000000000951', 1500, NULL)), 'true');
SELECT pg_temp.assert_eq('it removed what was left of the grant (1,100), leaving 0',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000951'), '0');
SELECT pg_temp.assert_eq('purchased top-ups are untouched',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000951'), '3300');
SELECT pg_temp.assert_eq('the account is revoked',
  (SELECT free_grant_state FROM profiles WHERE id = '00000000-0000-4000-8000-000000000951'), 'revoked');
SELECT pg_temp.assert_eq('the take-back is recorded with its amount',
  (SELECT removed_credits::text || '/' || previous_state FROM free_grant_revocations WHERE user_id = '00000000-0000-4000-8000-000000000951'), '1100/granted');
SELECT pg_temp.assert_eq('only the grant comes off credits an admin added on top',
  (SELECT new_credits::text FROM revoke_signup_grant('00000000-0000-4000-8000-000000000956', 1500, NULL)), '500');

-- 2. A revoked account cannot get the grant back on its own.
SELECT pg_temp.assert_eq('a revoked account cannot claim',
  (SELECT did_claim::text FROM claim_signup_grant('00000000-0000-4000-8000-000000000951', 1500)), 'false');
SELECT pg_temp.assert_eq('a revoked account cannot activate with a card',
  (SELECT did_activate::text FROM activate_signup_grant('00000000-0000-4000-8000-000000000951', 1500)), 'false');
SELECT pg_temp.assert_eq('...and neither moved a credit',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000951'), '0');
SELECT pg_temp.assert_eq('a second take-back is refused',
  (SELECT refusal FROM revoke_signup_grant('00000000-0000-4000-8000-000000000951', 1500, NULL)), 'not_revocable');

-- 3. Restore puts back exactly what was taken, in the state it was taken from.
SELECT pg_temp.assert_eq('restore reinstates',
  (SELECT did_reinstate::text FROM reinstate_signup_grant('00000000-0000-4000-8000-000000000951')), 'true');
SELECT pg_temp.assert_eq('restore returns exactly the 1,100 taken',
  (SELECT subscription_credits::text || '/' || free_grant_state FROM profiles WHERE id = '00000000-0000-4000-8000-000000000951'), '1100/granted');
SELECT pg_temp.assert_eq('the record is gone after a restore',
  (SELECT count(*)::text FROM free_grant_revocations WHERE user_id = '00000000-0000-4000-8000-000000000951'), '0');
SELECT pg_temp.assert_eq('a second restore is refused',
  (SELECT refusal FROM reinstate_signup_grant('00000000-0000-4000-8000-000000000951')), 'not_revoked');

-- 4. A withheld account: nothing to take, but its card path closes.
SELECT pg_temp.assert_eq('a withheld account can be revoked',
  (SELECT did_revoke::text || '/' || new_credits::text FROM revoke_signup_grant('00000000-0000-4000-8000-000000000952', 1500, NULL)), 'true/0');
SELECT pg_temp.assert_eq('...after which a card cannot activate it',
  (SELECT did_activate::text FROM activate_signup_grant('00000000-0000-4000-8000-000000000952', 1500)), 'false');
SELECT pg_temp.assert_eq('restore returns it to withheld, not to granted',
  (SELECT state FROM reinstate_signup_grant('00000000-0000-4000-8000-000000000952')), 'withheld');

-- 5. Refusals move nothing.
SELECT pg_temp.assert_eq('a paid tier is refused',
  (SELECT refusal FROM revoke_signup_grant('00000000-0000-4000-8000-000000000953', 1500, NULL)), 'paid_account');
SELECT pg_temp.assert_eq('any subscription ever (even canceled) is refused',
  (SELECT refusal FROM revoke_signup_grant('00000000-0000-4000-8000-000000000954', 1500, NULL)), 'paid_account');
SELECT pg_temp.assert_eq('an open reservation is refused',
  (SELECT refusal FROM revoke_signup_grant('00000000-0000-4000-8000-000000000955', 1500, NULL)), 'reservations_open');
SELECT pg_temp.assert_eq('...and moved nothing',
  (SELECT subscription_credits::text || '/' || free_grant_state FROM profiles WHERE id = '00000000-0000-4000-8000-000000000955'), '1500/granted');
SELECT pg_temp.assert_eq('an old reservation whose job is still held for review is refused — a reject would refund it',
  (SELECT refusal FROM revoke_signup_grant('00000000-0000-4000-8000-000000000958', 1500, NULL)), 'reservations_open');
SELECT pg_temp.assert_eq('an old leftover on a finished job never settles, so it does not refuse the take-back',
  (SELECT did_revoke::text FROM revoke_signup_grant('00000000-0000-4000-8000-000000000957', 1500, NULL)), 'true');
SELECT pg_temp.assert_eq('an unknown account is refused',
  (SELECT refusal FROM revoke_signup_grant('00000000-0000-4000-8000-0000000009ff', 1500, NULL)), 'not_found');

-- 6. The state column admits exactly the four states.
DO $$ BEGIN
  UPDATE profiles SET free_grant_state = 'bogus' WHERE id = '00000000-0000-4000-8000-000000000953';
  RAISE EXCEPTION 'ASSERT FAIL: free_grant_state accepted an unknown value';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  free_grant_state refuses an unknown value';
END $$;

-- 7. The block tables keep their shape.
DO $$ BEGIN
  INSERT INTO blocked_networks (network_hash, cidr, expires_at) VALUES (repeat('a', 64), '203.0.113.0/24', now() + interval '1 day');
  RAISE EXCEPTION 'ASSERT FAIL: a network block named both a hash and a range';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  a network block names exactly one target';
END $$;
DO $$ BEGIN
  INSERT INTO blocked_networks (cidr, expires_at) VALUES ('203.0.113.0/24', now() - interval '1 day');
  RAISE EXCEPTION 'ASSERT FAIL: a network block expired before it was created';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  a network block expires after it is created';
END $$;
INSERT INTO account_blocks (user_id, reason) VALUES ('00000000-0000-4000-8000-000000000953', 'test');
INSERT INTO blocked_networks (cidr, expires_at) VALUES ('198.51.100.0/24', now() + interval '1 day');
SELECT pg_temp.assert_eq('a network block is liftable by any admin unless marked otherwise',
  (SELECT super_admin_only::text FROM blocked_networks WHERE cidr = '198.51.100.0/24'), 'false');

-- 8. A signed-in user can neither run the functions nor see or touch the tables.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000953","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM revoke_signup_grant('00000000-0000-4000-8000-000000000956', 1500, NULL);
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user ran revoke_signup_grant';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot run revoke_signup_grant';
END $$;
DO $$ BEGIN
  PERFORM reinstate_signup_grant('00000000-0000-4000-8000-000000000956');
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user ran reinstate_signup_grant';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot run reinstate_signup_grant';
END $$;
DO $$ BEGIN
  PERFORM 1 FROM account_blocks;
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user read account_blocks';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot read account_blocks';
END $$;
DO $$ BEGIN
  DELETE FROM account_blocks WHERE user_id = '00000000-0000-4000-8000-000000000953';
  RAISE EXCEPTION 'ASSERT FAIL: a blocked user deleted their own block';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a blocked user cannot lift their own block';
END $$;
DO $$ BEGIN
  PERFORM 1 FROM blocked_networks;
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user read blocked_networks';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot read blocked_networks';
END $$;
DO $$ BEGIN
  PERFORM 1 FROM free_grant_revocations;
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user read free_grant_revocations';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot read free_grant_revocations';
END $$;
RESET ROLE;
SELECT pg_temp.assert_eq('the block is still there',
  (SELECT count(*)::text FROM account_blocks WHERE user_id = '00000000-0000-4000-8000-000000000953'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
