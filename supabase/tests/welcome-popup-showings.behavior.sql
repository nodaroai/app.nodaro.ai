-- ============================================================================
-- Behavioral proof: migration 653 adds the welcome pop-up's showing count to
-- `profiles` — `welcome_offer_declined_at`, `welcome_offer_shown_count`,
-- `welcome_offer_last_shown_at` — as columns ONLY THE SERVER writes.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000006531 upward).
--
-- WHY THIS PROOF EXISTS. The migration adds nothing to the profiles UPDATE
-- denylist, on the strength of 598's column grant (a browser session may
-- update `last_workspace_id` and nothing else). Nothing in 653's text shows
-- that grant still holds, so the effect is asserted:
--   1.   a new account starts with nothing counted (the defaults the server's
--        rule reads as "never shown");
--   2-4. a browser session, on its own row, can write none of the three
--        (so it cannot reopen the pop-up for itself, or spend its showings);
--   5.   the service role (POST /v1/credits/welcome-offer/seen) writes all
--        three, and the count can never be null.
-- The backfill (an old close counted as one showing) runs before any proof
-- can insert a row; the server reads such a row the same way with or without
-- it (`recordedShowings` in welcome-popup-rule.ts, unit-tested there).
--
-- Run locally (throwaway container, same image family as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/welcome-popup-showings.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000006531', 'wp-user@wp.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profile created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000006531'), '1');

-- ---------------------------------------------------------------------------
-- 1. A new account: nothing counted, no answer.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('a new account has no showing counted',
  (SELECT welcome_offer_shown_count::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000006531'), '0');
SELECT pg_temp.assert_eq('a new account has no last showing',
  (SELECT coalesce(welcome_offer_last_shown_at::text, 'null') FROM profiles WHERE id = '00000000-0000-4000-8000-000000006531'), 'null');
SELECT pg_temp.assert_eq('a new account has no answer',
  (SELECT coalesce(welcome_offer_declined_at::text, 'null') FROM profiles WHERE id = '00000000-0000-4000-8000-000000006531'), 'null');

-- ---------------------------------------------------------------------------
-- 2-4. The user's own JWT, on their own row: what a browser holding that
--      token can do over PostgREST.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000006531","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000006531';

DO $$ BEGIN
  UPDATE profiles SET welcome_offer_shown_count = 3 WHERE id = '00000000-0000-4000-8000-000000006531';
  RAISE EXCEPTION 'ASSERT FAIL: a user wrote their own welcome_offer_shown_count';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a user cannot write their own welcome_offer_shown_count (refused)';
END $$;

DO $$ BEGIN
  UPDATE profiles SET welcome_offer_last_shown_at = now() WHERE id = '00000000-0000-4000-8000-000000006531';
  RAISE EXCEPTION 'ASSERT FAIL: a user wrote their own welcome_offer_last_shown_at';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a user cannot write their own welcome_offer_last_shown_at (refused)';
END $$;

DO $$ BEGIN
  UPDATE profiles SET welcome_offer_declined_at = now() WHERE id = '00000000-0000-4000-8000-000000006531';
  RAISE EXCEPTION 'ASSERT FAIL: a user wrote their own welcome_offer_declined_at';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a user cannot write their own welcome_offer_declined_at (refused)';
END $$;
RESET ROLE;

SELECT pg_temp.assert_eq('the row is unchanged after the attempts',
  (SELECT welcome_offer_shown_count::text || '/' || coalesce(welcome_offer_last_shown_at::text, 'null') || '/' || coalesce(welcome_offer_declined_at::text, 'null')
     FROM profiles WHERE id = '00000000-0000-4000-8000-000000006531'), '0/null/null');

-- ---------------------------------------------------------------------------
-- 5. The service role writes all three, as the route does (a showing counted
--    over the values it read, then "Maybe later", first one wins).
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
UPDATE profiles
   SET welcome_offer_shown_count = 1,
       welcome_offer_last_shown_at = '2026-11-16T10:00:00Z',
       welcome_offer_seen_at = '2026-11-16T10:00:00Z'
 WHERE id = '00000000-0000-4000-8000-000000006531'
   AND welcome_offer_shown_count = 0
   AND welcome_offer_last_shown_at IS NULL
   AND welcome_offer_seen_at IS NULL;
UPDATE profiles SET welcome_offer_declined_at = '2026-11-16T10:01:00Z'
 WHERE id = '00000000-0000-4000-8000-000000006531' AND welcome_offer_declined_at IS NULL;
UPDATE profiles SET welcome_offer_declined_at = '2026-11-16T11:00:00Z'
 WHERE id = '00000000-0000-4000-8000-000000006531' AND welcome_offer_declined_at IS NULL;
SELECT pg_temp.assert_eq('the service role counts a showing and records the answer, first one wins',
  (SELECT welcome_offer_shown_count::text || '/' || (welcome_offer_last_shown_at = '2026-11-16T10:00:00Z')::text || '/' || (welcome_offer_declined_at = '2026-11-16T10:01:00Z')::text
     FROM profiles WHERE id = '00000000-0000-4000-8000-000000006531'), '1/true/true');

DO $$ BEGIN
  UPDATE profiles SET welcome_offer_shown_count = NULL WHERE id = '00000000-0000-4000-8000-000000006531';
  RAISE EXCEPTION 'ASSERT FAIL: welcome_offer_shown_count accepted null';
EXCEPTION WHEN not_null_violation THEN
  RAISE NOTICE 'ok  welcome_offer_shown_count is never null';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
