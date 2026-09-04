-- ============================================================================
-- Behavioral proof: migration 381 hides the DEPLOYMENT PAYER's profiles row
-- from admins — and hides NOTHING on a mainline deployment.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000971 upward).
--
-- WHY THIS PROOF EXISTS. Two failure modes, opposite in direction, and each
-- one invisible in the SQL text:
--
--   (a) THE LEAK IT CLOSES. On a deployment-payer instance the payer's
--       `profiles` row holds the deployment's real Nodaro credits, and the
--       customer mints its own admins. Under 032's policy
--       (`(select auth.uid()) = id OR is_admin()`) any of those admins could
--       read that balance from the browser over PostgREST. No route change
--       closes it, so it is closed in RLS — assertions 5-7. RLS is only half
--       of it: two pre-existing SECURITY DEFINER functions read `profiles` by
--       uuid under no policy at all and were EXECUTE-granted to anon, so the
--       uuid this migration's own helper hands out composed into the same
--       balance without an account — assertions 7b.
--
--   (b) THE MAINLINE REGRESSION IT WOULD BE. `id <> NULL` is NULL, and a
--       policy whose USING expression is NULL DENIES the row. Drop the
--       `IS NULL` disjunct and every admin on every deployment that never
--       configures a payer loses every row of `profiles` — silently, at the
--       moment the migration applies. Assertions 2-3 pin that case FIRST, and
--       assertion 9 pins that clearing the payer restores it.
--
-- The policy is inert until `payer_user_id` is written, and the only writer is
-- `configureDeploymentPayer()`'s boot upsert (deployment-payer.ts) — which is
-- why that TypeScript ships in the same PR as the migration.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/profiles-payer-row-hidden.behavior.sql mig-test:/tmp/t.sql
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

-- Three principals: an ordinary user, an admin (the attacker in case (a)), and
-- the payer whose row is the whole subject of this proof.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000971', 'pp-user@pp.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000972', 'pp-admin@pp.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000973', 'pp-payer@pp.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@pp.test'), '3');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000000972';
-- The balance case (a) is about. Service role reads it throughout; nothing
-- below ever asserts an admin can read this number.
UPDATE profiles SET credits_balance = 4242 WHERE id = '00000000-0000-4000-8000-000000000973';

-- ---------------------------------------------------------------------------
-- 1. The settings table is service-role-only: RLS on, no policy, no grant.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('deployment_payer_settings has RLS enabled',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.deployment_payer_settings'::regclass), 'true');
SELECT pg_temp.assert_eq('deployment_payer_settings has NO policy of any kind',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='deployment_payer_settings'), '0');
SELECT pg_temp.assert_eq('authenticated has no SELECT privilege on deployment_payer_settings',
  has_table_privilege('authenticated', 'public.deployment_payer_settings', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('anon has no SELECT privilege on deployment_payer_settings',
  has_table_privilege('anon', 'public.deployment_payer_settings', 'SELECT')::text, 'false');
-- The boot upsert's path. If the image's default privileges ever stopped
-- granting these, `configureDeploymentPayer()` would refuse boot on the hosted
-- instance and this line is where that is discovered instead.
SELECT pg_temp.assert_eq('service_role may INSERT the settings row (the boot upsert)',
  has_table_privilege('service_role', 'public.deployment_payer_settings', 'INSERT')::text, 'true');
SELECT pg_temp.assert_eq('service_role may UPDATE the settings row (the boot refresh)',
  has_table_privilege('service_role', 'public.deployment_payer_settings', 'UPDATE')::text, 'true');

-- ...and an admin session cannot read it at all (the row names the payer).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000972","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000972';
DO $$ BEGIN
  PERFORM count(*) FROM deployment_payer_settings;
  RAISE EXCEPTION 'ASSERT FAIL: an admin SELECT on deployment_payer_settings succeeded';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  an admin SELECT on deployment_payer_settings is denied';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2-3. MAINLINE IDENTITY. No settings row at all ⇒ the helper answers NULL and
--      the policy is exactly 032's. This is the regression that would take out
--      every admin on every deployment, so it is asserted before anything else.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('with no settings row the helper answers NULL',
  coalesce(deployment_payer_user_id()::text, '<null>'), '<null>');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000972","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000972';
SELECT pg_temp.assert_eq('MAINLINE: an admin still sees all three profiles',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@pp.test'), '3');
RESET ROLE;

-- 4. A settings row whose payer_user_id is still NULL is the same case: the row
--    is born at boot and the column is filled in the same statement, but a
--    half-written row must never blind the admin list either.
INSERT INTO deployment_payer_settings (id, payer_user_id, default_allowance_credits)
VALUES (true, NULL, 0);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000972","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000972';
SELECT pg_temp.assert_eq('a settings row with a NULL payer changes nothing for an admin',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@pp.test'), '3');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5-7. THE LEAK, CLOSED. The settings row names the payer.
-- ---------------------------------------------------------------------------
UPDATE deployment_payer_settings SET payer_user_id = '00000000-0000-4000-8000-000000000973' WHERE id = true;
SELECT pg_temp.assert_eq('the helper now answers the payer id',
  deployment_payer_user_id()::text, '00000000-0000-4000-8000-000000000973');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000972","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000972';
-- 5. The payer's row is gone from the admin's list...
SELECT pg_temp.assert_eq('an admin now sees two of the three profiles',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@pp.test'), '2');
SELECT pg_temp.assert_eq('the row an admin loses is the PAYER''s',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000973'), '0');
-- 6. ...and the balance is what that row was hiding. Assert on the VALUE, which
--    is what an attacker is actually after; a redacted column would still fail
--    here, a hidden row answers <null> because there is no row.
SELECT pg_temp.assert_eq('an admin cannot read the payer''s credits_balance',
  coalesce((SELECT credits_balance::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000973'), '<null>'), '<null>');
-- 7. NOT VACUOUS: the same admin in the same session still reads everyone else,
--    including the ordinary user's balance. The narrowing is one row wide.
SELECT pg_temp.assert_eq('the same admin still reads the ordinary user''s row',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000971'), '1');
SELECT pg_temp.assert_eq('the same admin still reads its own row',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000972'), '1');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7b. THE COMPOSED LEAK, CLOSED. RLS is not the only reader of `profiles`.
-- ---------------------------------------------------------------------------
-- 5-7 prove ONE read path is denied: a browser-direct SELECT. A SECURITY
-- DEFINER function is subject to NO policy, and two pre-existing ones read
-- `profiles` BY UUID — get_total_credits(uuid) (017:216) and
-- check_credits(uuid,integer) (022:62) — with Supabase's default privileges
-- granting EXECUTE to anon and authenticated. Composed with the uuid section 2
-- itself hands out, they returned the payer's exact balance with no account at
-- all. Migration 381 section 2b revokes both, naming the two roles because the
-- ACL carries explicit entries for them and `FROM PUBLIC` alone leaves the leak
-- open. These assertions are the DURABLE half of that fix: a future migration
-- that recreates either function with a GRANT (or a new SECURITY DEFINER reader
-- of profiles-by-uuid granted to a browser role) fails right here.
SELECT pg_temp.assert_eq('anon may NOT execute get_total_credits(uuid)',
  has_function_privilege('anon', 'public.get_total_credits(uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated may NOT execute get_total_credits(uuid)',
  has_function_privilege('authenticated', 'public.get_total_credits(uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('anon may NOT execute check_credits(uuid, integer)',
  has_function_privilege('anon', 'public.check_credits(uuid,integer)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated may NOT execute check_credits(uuid, integer)',
  has_function_privilege('authenticated', 'public.check_credits(uuid,integer)', 'EXECUTE')::text, 'false');
-- NOT VACUOUS, and the reason the revoke is safe: the SERVICE ROLE — the
-- backend's own client, which is how every legitimate balance read happens —
-- holds an explicit grant the revoke does not touch.
SELECT pg_temp.assert_eq('service_role KEEPS execute on get_total_credits(uuid)',
  has_function_privilege('service_role', 'public.get_total_credits(uuid)', 'EXECUTE')::text, 'true');
SELECT pg_temp.assert_eq('service_role KEEPS execute on check_credits(uuid, integer)',
  has_function_privilege('service_role', 'public.check_credits(uuid,integer)', 'EXECUTE')::text, 'true');

-- End to end as `anon`, with NO JWT at all — the publishable key that ships in
-- every browser bundle. The helper still answers, and that is deliberate: its
-- EXECUTE grant must NOT be revoked, because the profiles policy is evaluated
-- as `authenticated` and an EXECUTE denial inside a USING expression RAISES,
-- which would blank every admin's profiles read on every mainline deployment.
SET LOCAL ROLE anon;
SELECT pg_temp.assert_eq('anon still learns the payer uuid from the helper (accepted side effect)',
  deployment_payer_user_id()::text, '00000000-0000-4000-8000-000000000973');
-- ...and the uuid is now INERT: neither reader will turn it into a balance.
DO $$ BEGIN
  PERFORM get_total_credits(deployment_payer_user_id());
  RAISE EXCEPTION 'ASSERT FAIL: anon read the payer balance through get_total_credits()';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon get_total_credits(payer uuid) is denied';
END $$;
DO $$ BEGIN
  PERFORM check_credits(deployment_payer_user_id(), 999999999);
  RAISE EXCEPTION 'ASSERT FAIL: anon read the payer balance through check_credits()';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon check_credits(payer uuid, n) is denied';
END $$;
RESET ROLE;

-- 8. The two "own row" disjuncts are untouched: a plain user sees exactly its
--    own row, and THE PAYER STILL SEES ITS OWN. (If the payer lost its own row
--    the billing account's page — which reads the real balance — would show
--    nothing, and the payer's own generations would be refused client-side.)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000971","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000971';
SELECT pg_temp.assert_eq('an ordinary user still sees exactly its own profile',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@pp.test'), '1');
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000973","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000973';
SELECT pg_temp.assert_eq('the PAYER still reads its own profile row',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000973'), '1');
SELECT pg_temp.assert_eq('the payer still reads its own credits_balance',
  (SELECT credits_balance::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000973'), '4242');
RESET ROLE;

-- 9. And the narrowing is DATA, not schema: clearing the payer id restores the
--    admin's full view in the same session. This is the property that makes the
--    mainline claim in 2-3 an argument rather than an accident — the policy has
--    exactly one input, and it is the settings row.
UPDATE deployment_payer_settings SET payer_user_id = NULL WHERE id = true;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000972","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000972';
SELECT pg_temp.assert_eq('clearing payer_user_id restores the admin''s full view',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@pp.test'), '3');
RESET ROLE;

-- 10. The service role — the backend's own client, which is what the billing
--     account's page reads through — is never affected by any of this.
SELECT pg_temp.assert_eq('service role (this session) reads the payer row throughout',
  (SELECT credits_balance::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000973'), '4242');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
