-- ============================================================================
-- Behavioral proof: model_pricing is readable by admins only (migration 345).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000901 upward).
--
-- The assertion that matters is #2: a signed-in NON-admin reads ZERO rows. A
-- policy text review cannot prove that -- only executing as the role can. It
-- also fails if any FUTURE migration re-adds a permissive SELECT policy, which
-- is the way this leak would come back.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/model-pricing-privacy.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000000901', 'mp-user@mp.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000902', 'mp-admin@mp.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@mp.test'), '2');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000000902';

-- 0. The proof is not vacuous: the table has seeded rows to be denied.
SELECT pg_temp.assert_eq('model_pricing has seeded rows (as postgres)',
  (SELECT (count(*) > 0)::text FROM model_pricing), 'true');

-- 1. The permissive policy is gone, BY NAME, and nothing unconditional
--    replaced it. `qual = 'true'` catches a differently-named re-introduction.
SELECT pg_temp.assert_eq('the "Anyone can read model pricing" policy is gone',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='model_pricing'
      AND policyname='Anyone can read model pricing'), '0');
SELECT pg_temp.assert_eq('no unconditional SELECT policy remains on model_pricing',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='model_pricing'
      AND cmd IN ('SELECT','ALL') AND qual = 'true'), '0');

-- 2. THE LEAK: a signed-in non-admin reads nothing.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000901","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
SELECT pg_temp.assert_eq('a signed-in NON-admin reads zero model_pricing rows',
  (SELECT count(*)::text FROM model_pricing), '0');
RESET ROLE;

-- 3. Anonymous reads nothing either. Clear the JWT so this is a true anon
--    read (auth.uid() IS NULL -> is_admin() FALSE, fail-closed not raising),
--    not the previous user's claims lingering under a different role.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
SELECT pg_temp.assert_eq('an anonymous caller reads zero model_pricing rows',
  (SELECT count(*)::text FROM model_pricing), '0');
RESET ROLE;

-- 4. ...and the swap did not simply delete access: an admin still reads.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000902","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000902';
SELECT pg_temp.assert_eq('an admin still reads model_pricing',
  (SELECT (count(*) > 0)::text FROM model_pricing), 'true');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
