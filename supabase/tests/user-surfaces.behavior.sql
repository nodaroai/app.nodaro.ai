-- ============================================================================
-- Behavioral proof: migration 607's `user_surfaces` — the surfaces each account
-- has used, written only by the server's role through `touch_user_surface`.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000a71 upward).
--
-- WHAT IS PROVED, and why it is not readable from the SQL text alone:
--   1-3. A first sighting inserts a row with one touch; a second moves
--        last_seen_at and counts; the detail is cut at 80 characters, so an
--        over-long one lands on the same row as its cut form.
--   4.   A source the code cannot name is refused (the CHECK), so a widened
--        `JOB_SOURCES` fails loudly here rather than writing an unknown kind.
--   5-6. The cap: an account's 51st surface is not recorded, while a surface
--        it already has keeps counting — the detail is the caller's own word,
--        and without the cap one account could grow the table a row per request.
--   7-8. Nothing through PostgREST: a user's JWT can neither execute the
--        function nor read the table; the service role can do both.
--
-- Run locally (throwaway container, same image family as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/user-surfaces.behavior.sql mig-test:/tmp/t.sql
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

-- One account; the auth trigger makes its profile, which the table references.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000a71', 'us-user@us.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('the profile exists',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000a71'), '1');

-- ---------------------------------------------------------------------------
-- 1-3. Insert, touch, cut.
-- ---------------------------------------------------------------------------
SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'extension', 'extension/ext.nodaro.ai@0.2.6');
SELECT pg_temp.assert_eq('a first sighting is one row with one touch',
  (SELECT touches::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'extension'), '1');

SELECT pg_temp.assert_eq('and first_seen_at equals last_seen_at on it',
  (SELECT (first_seen_at = last_seen_at)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'extension'), 'true');

SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'extension', 'extension/ext.nodaro.ai@0.2.6');
SELECT pg_temp.assert_eq('a second sighting counts on the same row',
  (SELECT touches::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'extension'), '2');
SELECT pg_temp.assert_eq('still one row for the surface',
  (SELECT count(*)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71'), '1');
SELECT pg_temp.assert_eq('last_seen_at did not move back before first_seen_at',
  (SELECT (last_seen_at >= first_seen_at)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'extension'), 'true');

-- A detail over 80 characters is cut, and lands on the row of its cut form.
SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'web', repeat('h', 79) || '.nodaro.ai:443');
SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'web', repeat('h', 79) || '.nodaro.ai');
SELECT pg_temp.assert_eq('an over-long detail is cut at 80 characters',
  (SELECT char_length(detail)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'web'), '80');
SELECT pg_temp.assert_eq('and both long forms share that one row',
  (SELECT touches::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'web'), '2');

-- A null detail is the empty one.
SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'api', NULL);
SELECT pg_temp.assert_eq('a null detail is stored as the empty detail',
  (SELECT count(*)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'api' AND detail = ''), '1');

-- ---------------------------------------------------------------------------
-- 4. A kind of caller the code cannot name is refused.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  PERFORM public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'bogus', 'x');
  RAISE EXCEPTION 'ASSERT FAIL: an unknown source was recorded';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  an unknown source is refused';
END $$;

-- ---------------------------------------------------------------------------
-- 5-6. The cap at 50 rows per account.
-- ---------------------------------------------------------------------------
-- Three rows exist (extension, web, api); 47 more distinct MCP client names fill the account.
DO $$ BEGIN
  FOR i IN 1..47 LOOP
    PERFORM public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'mcp', 'client-' || i);
  END LOOP;
END $$;
SELECT pg_temp.assert_eq('the account holds 50 rows',
  (SELECT count(*)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71'), '50');

SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'mcp', 'client-51st');
SELECT pg_temp.assert_eq('a 51st surface is not recorded',
  (SELECT count(*)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71'), '50');
SELECT pg_temp.assert_eq('and leaves no row of its own',
  (SELECT count(*)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND detail = 'client-51st'), '0');

SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'extension', 'extension/ext.nodaro.ai@0.2.6');
SELECT pg_temp.assert_eq('a surface the account already has keeps counting past the cap',
  (SELECT touches::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a71' AND source = 'extension'), '3');

-- Another account is not held back by the first one's cap.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000a72', 'us-other@us.test', '{}', 'authenticated', 'authenticated');
SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a72', 'extension', 'extension/ext.nodaro.ai@0.2.6');
SELECT pg_temp.assert_eq('the cap is per account',
  (SELECT count(*)::text FROM user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a72'), '1');

-- ---------------------------------------------------------------------------
-- 7. A user's own JWT reaches neither the function nor the table.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000a71","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000a71';
DO $$ BEGIN
  PERFORM public.touch_user_surface('00000000-0000-4000-8000-000000000a71', 'web', 'forged.example');
  RAISE EXCEPTION 'ASSERT FAIL: a user executed touch_user_surface';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a user cannot execute touch_user_surface';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM public.user_surfaces;
  RAISE EXCEPTION 'ASSERT FAIL: a user read user_surfaces';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a user cannot read user_surfaces';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8. The server's role can do both.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT public.touch_user_surface('00000000-0000-4000-8000-000000000a72', 'cli', 'cli/1.4.0');
SELECT pg_temp.assert_eq('the service role writes through the function',
  (SELECT count(*)::text FROM public.user_surfaces WHERE user_id = '00000000-0000-4000-8000-000000000a72'), '2');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
