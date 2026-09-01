-- ============================================================================
-- Behavioral proof: app_settings is admin-READABLE but not admin-WRITABLE
-- (migration 363).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000911 upward).
--
-- WHY THIS PROOF EXISTS. `cost_markup_percent` and `service_margin_percent`
-- live in this table and are multiplied into every credit charge. The route
-- that edits them is gated by requirePlatformOperator, which on a
-- deployment-payer instance means "only the platform operator may change what
-- things cost". That claim is only true if the DB agrees: from 005 until 363
-- the table carried FOR ALL USING (is_admin()), and a FOR ALL policy with no
-- WITH CHECK reuses USING as the write check — so an admin could skip the
-- route and write the row from the browser. Assertion #3 is the one that
-- matters; it also fails if a future migration re-adds a write policy, which
-- is how this would come back.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/app-settings-privacy.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000000911', 'as-user@as.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000912', 'as-admin@as.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@as.test'), '2');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000000912';

-- Seed the lever this proof is about, as postgres (service role bypasses RLS).
INSERT INTO app_settings (key, value) VALUES ('cost_markup_percent', '40'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 0. Not vacuous: the row exists to be denied.
SELECT pg_temp.assert_eq('cost_markup_percent is present (as postgres)',
  (SELECT count(*)::text FROM app_settings WHERE key = 'cost_markup_percent'), '1');

-- 1. The FOR ALL policy is gone BY NAME, and no write policy replaced it under
--    any name. A policy with cmd ALL/INSERT/UPDATE/DELETE is a write path.
SELECT pg_temp.assert_eq('the "Admins can manage settings" policy is gone',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='app_settings'
      AND policyname='Admins can manage settings'), '0');
SELECT pg_temp.assert_eq('no write policy remains on app_settings',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='app_settings'
      AND cmd IN ('ALL','INSERT','UPDATE','DELETE')), '0');

-- 2. An admin can still READ — the swap narrowed the capability, it did not
--    delete it (the admin UI's settings page must keep working).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000912","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000912';
SELECT pg_temp.assert_eq('an admin still reads app_settings',
  (SELECT (count(*) > 0)::text FROM app_settings), 'true');

-- 3. THE HOLE: the same admin cannot move the price lever. RLS denies the
--    UPDATE silently (zero rows matched), so assert on the VALUE, which is
--    what an attacker would be after.
UPDATE app_settings SET value = '0'::jsonb WHERE key = 'cost_markup_percent';
RESET ROLE;
SELECT pg_temp.assert_eq('an admin UPDATE cannot change cost_markup_percent',
  (SELECT value::text FROM app_settings WHERE key = 'cost_markup_percent'), '40');

-- 4. ...nor insert a fresh lever row (the upsert shape a browser would use).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000912","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000912';
DO $$ BEGIN
  -- A key no migration seeds, so a unique_violation cannot masquerade as the
  -- RLS refusal this asserts.
  INSERT INTO app_settings (key, value) VALUES ('as_probe_only_key', '{"kie":0}'::jsonb);
  RAISE EXCEPTION 'ASSERT FAIL: an admin INSERT into app_settings succeeded';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  an admin INSERT into app_settings is denied';
END $$;
RESET ROLE;

-- 5. And a non-admin reads nothing at all (unchanged by 363, pinned so a
--    future permissive read policy cannot slip in beside the narrowed write).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000911","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000911';
SELECT pg_temp.assert_eq('a signed-in NON-admin reads zero app_settings rows',
  (SELECT count(*)::text FROM app_settings), '0');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
