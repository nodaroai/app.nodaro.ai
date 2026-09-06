-- ============================================================================
-- Behavioral proof: migration 385 puts `profiles.email` on the list of columns
-- a user may NOT rewrite — and takes nothing else away from them.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000991 upward).
--
-- WHY THIS PROOF EXISTS. Two claims, opposite in direction, and neither one
-- readable from the SQL text:
--
--   (a) THE HOLE IT CLOSES. The "Users can update own safe columns" policy is
--       a DENYLIST — every column `check_profiles_update_allowed` does not
--       name is writable by the row's owner with their own browser JWT, and
--       `email` was never named. `idx_profiles_email` (099) is a plain,
--       NON-UNIQUE index, so nothing at the storage layer objects either. On a
--       deployment that names a billing account, any authenticated user could
--       therefore write THE DEPLOYMENT'S BILLING ACCOUNT ADDRESS into their own
--       row; two rows then carry it, the SSO lookup's `maybeSingle()` errors,
--       and the money account's sign-in is refused. Assertion 1 is that write,
--       verbatim; assertion 5 is the invariant it was aimed at.
--
--   (b) THE REGRESSION IT MUST NOT BE. This policy is the ONLY thing standing
--       between the browser and every column of `profiles`, and the product
--       does perform one write through it: `last_workspace_id`
--       (`frontend/src/lib/workspace-context.ts`). A denylist entry is one
--       argument in a twenty-argument call — mis-order it, or drop the old
--       overload badly, and the policy stops accepting that write with no
--       error anywhere near this file. Assertion 4 pins it in the SAME session
--       as assertion 1, so the narrowing is proved on the same principal that
--       was just refused.
--
-- Assertion 6 keeps the backend whole (every server write to this table is
-- service-role, which is the authoritative writer of this column), and 7-9 pin
-- the SHAPE the 310/365 migrations established: exactly one overload — an
-- orphaned 19-argument twin would leave the old, `email`-blind function
-- resolvable — and a signature that ends in the new column.
--
-- Run locally (throwaway container, same image family as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/profiles-email-not-user-writable.behavior.sql mig-test:/tmp/t.sql
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

-- Two principals: an ordinary user (the attacker), and the account whose
-- address is the thing worth stealing — on a deployment that configures one,
-- this is the deployment's billing account, the identity the SSO path resolves
-- by matching exactly this column.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000991', 'pe-user@pe.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000992', 'pe-billing@pe.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@pe.test'), '2');
SELECT pg_temp.assert_eq('the billing account address matches exactly one row to start with',
  (SELECT count(*)::text FROM profiles WHERE email = 'pe-billing@pe.test'), '1');

-- The one legitimate browser write needs a real workspace to point at
-- (`last_workspace_id` is a FK), so the org and workspace are built here, as
-- the service session, before any role switch.
INSERT INTO organizations (id, slug, name, kind, owner_user_id, status) VALUES
  ('a0000000-0000-4000-8000-000000000991', 'pe-org', 'PE Org', 'team', '00000000-0000-4000-8000-000000000991', 'active');
INSERT INTO workspaces (id, org_id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000991', 'a0000000-0000-4000-8000-000000000991', 'PE Workspace', 'pe-workspace');

-- ---------------------------------------------------------------------------
-- 1-4. ONE authenticated session, the attacker's own JWT. Everything below is
--      what a browser holding that token can do over PostgREST.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000991","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000991';

-- 1. THE ATTACK. Writing the billing account's address into the attacker's own
--    row. The pin lives in WITH CHECK, so Postgres RAISES ("new row violates
--    row-level security policy") rather than filtering the row — but the
--    refusal is asserted by its EFFECT as well as its shape, because a future
--    revision that moved the pin into USING would refuse with 0 rows and no
--    error and must still pass here.
DO $$ BEGIN
  UPDATE profiles SET email = 'pe-billing@pe.test' WHERE id = '00000000-0000-4000-8000-000000000991';
  IF (SELECT email FROM profiles WHERE id = '00000000-0000-4000-8000-000000000991') = 'pe-billing@pe.test' THEN
    RAISE EXCEPTION 'ASSERT FAIL: a user rewrote their own email to the billing account address';
  END IF;
  RAISE NOTICE 'ok  a user cannot claim the billing account address (row unchanged)';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'ok  a user cannot claim the billing account address (refused)';
END $$;

-- 2. And it is the COLUMN that is pinned, not that one address: a plain
--    self-rename to an address nobody holds is refused just the same. Without
--    this, a denylist that only rejected duplicates would pass assertion 1 and
--    still leave the column browser-writable.
DO $$ BEGIN
  UPDATE profiles SET email = 'pe-user-renamed@pe.test' WHERE id = '00000000-0000-4000-8000-000000000991';
  IF (SELECT email FROM profiles WHERE id = '00000000-0000-4000-8000-000000000991') = 'pe-user-renamed@pe.test' THEN
    RAISE EXCEPTION 'ASSERT FAIL: a user renamed their own profiles.email';
  END IF;
  RAISE NOTICE 'ok  a user cannot rename their own email at all (the column is pinned)';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'ok  a user cannot rename their own email at all (refused)';
END $$;

-- 3. The attacker's own row — the only `profiles` row this session can read,
--    under 032's "own row or admin" SELECT policy — is unchanged by either.
SELECT pg_temp.assert_eq('the attacker''s own row still carries the attacker''s own address',
  (SELECT email FROM profiles WHERE id = '00000000-0000-4000-8000-000000000991'), 'pe-user@pe.test');

-- 4. THE NARROWNESS, in the same session and on the same row: the one write the
--    product actually makes through this policy still lands.
UPDATE profiles SET last_workspace_id = 'b0000000-0000-4000-8000-000000000991'
  WHERE id = '00000000-0000-4000-8000-000000000991';
SELECT pg_temp.assert_eq('the user can still write last_workspace_id (the browser''s one write)',
  (SELECT last_workspace_id::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000991'),
  'b0000000-0000-4000-8000-000000000991');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. The invariant the attack was aimed at, asserted from the session that
--    actually evaluates it: the SSO lookup runs as the service role and sees
--    the whole table. (Asserting this inside the attacker's session would be
--    meaningless — that session cannot see the billing account's row at all, so
--    it answers 0 whether the attack landed or not.) A 384 database would answer 2
--    here, which is the `maybeSingle()` error and the sign-in refusal.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('the billing account address still matches exactly one row',
  (SELECT count(*)::text FROM profiles WHERE email = 'pe-billing@pe.test'), '1');
SELECT pg_temp.assert_eq('and the row it matches is the billing account''s own',
  (SELECT id::text FROM profiles WHERE email = 'pe-billing@pe.test'),
  '00000000-0000-4000-8000-000000000992');

-- ---------------------------------------------------------------------------
-- 6. The backend is untouched. `service_role` is the authoritative writer of
--    this column (the auth trigger on INSERT, the account routes afterwards);
--    if this migration had reached it, an address change would stop
--    propagating into `profiles` and every lookup keyed on it would go stale.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
UPDATE profiles SET email = 'pe-user-moved@pe.test' WHERE id = '00000000-0000-4000-8000-000000000991';
SELECT pg_temp.assert_eq('the service role still updates profiles.email',
  (SELECT email FROM profiles WHERE id = '00000000-0000-4000-8000-000000000991'), 'pe-user-moved@pe.test');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7-9. THE SHAPE. Every touch of this function since 310 has had to drop the
--      previous overload by its full argument list; forget it and the old,
--      `email`-blind twin stays resolvable and the whole guard is a coin flip
--      on argument coercion. Asserted here so the NEXT column to join the
--      denylist inherits the check.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('check_profiles_update_allowed has exactly one overload',
  (SELECT count(*)::text FROM pg_proc WHERE proname = 'check_profiles_update_allowed'), '1');
SELECT pg_temp.assert_eq('its signature ends in the new column',
  (SELECT (pg_get_function_arguments(oid) LIKE '%p_email text')::text
     FROM pg_proc WHERE proname = 'check_profiles_update_allowed'), 'true');
SELECT pg_temp.assert_eq('the UPDATE policy exists and is the one the migration recreated',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Users can update own safe columns' AND cmd = 'UPDATE'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
