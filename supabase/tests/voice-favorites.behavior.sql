-- ============================================================================
-- Behavioral proof: voice_favorites is service-role only and keeps the rules the
-- API relies on (migration 608).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000971 upward).
--
-- What matters is #2 / #3: a signed-in user (even the row's OWNER) and an
-- anonymous caller cannot read or write the table through the API roles —
-- refused by privilege, before RLS is consulted. A policy text review cannot
-- prove that; executing as the role can. It also fails if a future migration
-- GRANTs the table back or adds a permissive policy. #4 pins the integrity the
-- backend relies on: one star per person per voice (the upsert's conflict
-- target), the kinds and lengths the routes accept, and the cascade.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/voice-favorites.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000000971', 'fav-owner@voices.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000972', 'fav-stranger@voices.test', '{}', 'authenticated', 'authenticated');

-- 0. The proof is not vacuous: a row exists to be denied (written as the service
--    role would write it — as postgres here).
INSERT INTO voice_favorites (id, user_id, voice_id, voice_type, name, preview_url)
VALUES ('00000000-0000-4000-8000-000000000973', '00000000-0000-4000-8000-000000000971',
        '21m00Tcm4TlvDq8ikWAM', 'premade', 'Rachel', 'https://cdn.example.com/rachel.mp3');
SELECT pg_temp.assert_eq('voice_favorites has a row (as postgres)',
  (SELECT count(*)::text FROM voice_favorites), '1');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled on voice_favorites',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'voice_favorites'), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on voice_favorites',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename = 'voice_favorites'), '0');
SELECT pg_temp.assert_eq('authenticated holds no SELECT privilege on voice_favorites',
  has_table_privilege('authenticated', 'public.voice_favorites', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no INSERT/UPDATE/DELETE privilege on voice_favorites',
  (has_table_privilege('authenticated', 'public.voice_favorites', 'INSERT')
   OR has_table_privilege('authenticated', 'public.voice_favorites', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.voice_favorites', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no SELECT privilege on voice_favorites',
  has_table_privilege('anon', 'public.voice_favorites', 'SELECT')::text, 'false');

-- 2. THE LEAK: the row's OWNER, signed in, cannot read or write it through the
--    API role — refused by privilege.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000971","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000971';
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM voice_favorites;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT voice_favorites as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT voice_favorites as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO voice_favorites (user_id, voice_id, voice_type, name)
    VALUES ('00000000-0000-4000-8000-000000000971', 'forged-voice', 'premade', 'Forged');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot INSERT voice_favorites]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot INSERT voice_favorites (privilege denied)';
END $$;
RESET ROLE;

-- 3. Anonymous is refused the same way. Clear the JWT so this is a true anon
--    read, not the previous user's claims lingering under a different role.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM voice_favorites;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon cannot SELECT voice_favorites]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  anon cannot SELECT voice_favorites (privilege denied)';
END $$;
RESET ROLE;

-- 4. Integrity the backend relies on.
-- 4a. One star per person per voice: the route's upsert conflicts on (user_id, voice_id).
DO $$
DECLARE dup boolean := false;
BEGIN
  BEGIN
    INSERT INTO voice_favorites (user_id, voice_id, voice_type, name)
    VALUES ('00000000-0000-4000-8000-000000000971', '21m00Tcm4TlvDq8ikWAM', 'premade', 'Rachel again');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
  END;
  IF NOT dup THEN
    RAISE EXCEPTION 'ASSERT FAIL [a voice is starred once per person]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a voice is starred once per person (unique_violation)';
END $$;
-- 4b. Another person may star the same voice.
INSERT INTO voice_favorites (id, user_id, voice_id, voice_type, name)
VALUES ('00000000-0000-4000-8000-000000000974', '00000000-0000-4000-8000-000000000972', '21m00Tcm4TlvDq8ikWAM', 'library', 'Rachel');
SELECT pg_temp.assert_eq('another person may star the same voice',
  (SELECT count(*)::text FROM voice_favorites WHERE voice_id = '21m00Tcm4TlvDq8ikWAM'), '2');
-- 4c. Only the three kinds the routes accept.
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO voice_favorites (user_id, voice_id, voice_type, name)
    VALUES ('00000000-0000-4000-8000-000000000971', 'some-voice', 'cloned', 'Nope');
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'ASSERT FAIL [an unknown voice kind is refused]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  an unknown voice kind is refused (check_violation)';
END $$;
-- 4d. The lengths the routes accept: a name over 200 characters is refused.
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO voice_favorites (user_id, voice_id, voice_type, name)
    VALUES ('00000000-0000-4000-8000-000000000971', 'long-name-voice', 'premade', repeat('n', 201));
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'ASSERT FAIL [a name over 200 characters is refused]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a name over 200 characters is refused (check_violation)';
END $$;
-- 4e. Deleting the user removes their stars; the other person's stay.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000971';
SELECT pg_temp.assert_eq('deleting the user cascades to their favorites',
  (SELECT count(*)::text FROM voice_favorites WHERE user_id = '00000000-0000-4000-8000-000000000971'), '0');
SELECT pg_temp.assert_eq('another person''s favorites are untouched',
  (SELECT count(*)::text FROM voice_favorites WHERE user_id = '00000000-0000-4000-8000-000000000972'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
