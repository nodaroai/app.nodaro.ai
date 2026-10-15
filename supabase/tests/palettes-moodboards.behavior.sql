-- ============================================================================
-- Behavioral proof: colour palettes and moodboards (migration 522).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000052201 upward).
--
-- What it pins:
--   1. Both tables are service-role only: RLS on, no policies, no privilege
--      for the API roles — the rows' OWNER signed in, and an anonymous caller,
--      are refused by privilege before RLS is consulted.
--   2. The constraints the prompt renderer relies on: 2..12 colours, each
--      '#RRGGBB' upper case; names 1..80; descriptions bounded; 1..12 moodboard
--      images, each an object with a string url and an optional string caption.
--   3. Deleting the person deletes their palettes and moodboards.
--
-- Run locally: see the header of collections.behavior.sql (same steps).
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

-- Runs `stmt` and passes only if a CHECK constraint refuses it.
CREATE FUNCTION pg_temp.assert_check_fails(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: the statement succeeded', label;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000052201', 'pm-owner@pm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000052202', 'pm-other@pm.test', '{}', 'authenticated', 'authenticated');

-- 0. The proof is not vacuous: rows exist to be denied (written as the service
--    role would write them — as postgres here).
INSERT INTO color_palettes (id, user_id, name, colors, description) VALUES
  ('00000000-0000-4000-8000-000000052211', '00000000-0000-4000-8000-000000052201',
   'Harbour', ARRAY['#0F4C5C', '#E3B23C', '#F28C7A'], 'Summer campaign');
INSERT INTO moodboards (id, user_id, name, description, images) VALUES
  ('00000000-0000-4000-8000-000000052221', '00000000-0000-4000-8000-000000052201',
   'Nordic calm', 'Moody Nordic interiors, soft daylight',
   '[{"url":"https://cdn.test/a.png","caption":"linen"},{"url":"https://cdn.test/b.png"}]');
SELECT pg_temp.assert_eq('a palette exists (as postgres)',
  (SELECT count(*)::text FROM color_palettes), '1');
SELECT pg_temp.assert_eq('a moodboard exists (as postgres)',
  (SELECT count(*)::text FROM moodboards), '1');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled on color_palettes',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'color_palettes'), 'true');
SELECT pg_temp.assert_eq('row level security is enabled on moodboards',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'moodboards'), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on either table',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('color_palettes', 'moodboards')), '0');
SELECT pg_temp.assert_eq('authenticated holds no privilege on color_palettes',
  (has_table_privilege('authenticated', 'public.color_palettes', 'SELECT')
   OR has_table_privilege('authenticated', 'public.color_palettes', 'INSERT')
   OR has_table_privilege('authenticated', 'public.color_palettes', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.color_palettes', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no privilege on moodboards',
  (has_table_privilege('authenticated', 'public.moodboards', 'SELECT')
   OR has_table_privilege('authenticated', 'public.moodboards', 'INSERT')
   OR has_table_privilege('authenticated', 'public.moodboards', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.moodboards', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no privilege on either table',
  (has_table_privilege('anon', 'public.color_palettes', 'SELECT')
   OR has_table_privilege('anon', 'public.color_palettes', 'INSERT')
   OR has_table_privilege('anon', 'public.moodboards', 'SELECT')
   OR has_table_privilege('anon', 'public.moodboards', 'INSERT'))::text, 'false');
SELECT pg_temp.assert_eq('service_role can read and write both tables',
  (has_table_privilege('service_role', 'public.color_palettes', 'SELECT')
   AND has_table_privilege('service_role', 'public.color_palettes', 'INSERT')
   AND has_table_privilege('service_role', 'public.moodboards', 'SELECT')
   AND has_table_privilege('service_role', 'public.moodboards', 'DELETE'))::text, 'true');

-- 1b. The rows' OWNER, signed in, cannot reach them through the API role.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000052201","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000052201';
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM color_palettes;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT color_palettes as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT color_palettes as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM moodboards;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT moodboards as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT moodboards as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO color_palettes (user_id, name, colors)
    VALUES ('00000000-0000-4000-8000-000000052201', 'forged', ARRAY['#000000', '#FFFFFF']);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot INSERT color_palettes]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot INSERT color_palettes (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    UPDATE moodboards SET name = 'taken' WHERE id = '00000000-0000-4000-8000-000000052221';
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot UPDATE moodboards]: the update succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot UPDATE moodboards (privilege denied)';
END $$;
RESET ROLE;

-- 1c. Anonymous is refused the same way. Clear the JWT so this is a true anon
--     read, not the previous user's claims lingering under a different role.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM color_palettes;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon cannot SELECT color_palettes]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  anon cannot SELECT color_palettes (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM moodboards;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon cannot SELECT moodboards]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  anon cannot SELECT moodboards (privilege denied)';
END $$;
RESET ROLE;

-- 2a. Palette constraints.
SELECT pg_temp.assert_check_fails('a palette needs at least 2 colours',
  $s$INSERT INTO color_palettes (user_id, name, colors)
     VALUES ('00000000-0000-4000-8000-000000052201', 'one', ARRAY['#000000'])$s$);
SELECT pg_temp.assert_check_fails('a palette holds at most 12 colours',
  $s$INSERT INTO color_palettes (user_id, name, colors)
     VALUES ('00000000-0000-4000-8000-000000052201', 'many', array_fill('#000000'::text, ARRAY[13]))$s$);
SELECT pg_temp.assert_check_fails('a colour must be #RRGGBB',
  $s$INSERT INTO color_palettes (user_id, name, colors)
     VALUES ('00000000-0000-4000-8000-000000052201', 'bad', ARRAY['#000000', 'teal'])$s$);
SELECT pg_temp.assert_check_fails('a colour is stored upper case',
  $s$INSERT INTO color_palettes (user_id, name, colors)
     VALUES ('00000000-0000-4000-8000-000000052201', 'lower', ARRAY['#000000', '#e3b23c'])$s$);
SELECT pg_temp.assert_check_fails('a colour list carries no NULL',
  $s$INSERT INTO color_palettes (user_id, name, colors)
     VALUES ('00000000-0000-4000-8000-000000052201', 'null', ARRAY['#000000', NULL, '#FFFFFF'])$s$);
SELECT pg_temp.assert_check_fails('a palette name is not blank',
  $s$INSERT INTO color_palettes (user_id, name, colors)
     VALUES ('00000000-0000-4000-8000-000000052201', '   ', ARRAY['#000000', '#FFFFFF'])$s$);
SELECT pg_temp.assert_check_fails('a palette name is at most 80 characters',
  $s$INSERT INTO color_palettes (user_id, name, colors)
     VALUES ('00000000-0000-4000-8000-000000052201', repeat('n', 81), ARRAY['#000000', '#FFFFFF'])$s$);
SELECT pg_temp.assert_check_fails('a palette description is at most 500 characters',
  $s$INSERT INTO color_palettes (user_id, name, colors, description)
     VALUES ('00000000-0000-4000-8000-000000052201', 'long', ARRAY['#000000', '#FFFFFF'], repeat('d', 501))$s$);
INSERT INTO color_palettes (user_id, name, colors)
  VALUES ('00000000-0000-4000-8000-000000052201', repeat('n', 80), array_fill('#ABCDEF'::text, ARRAY[12]));
SELECT pg_temp.assert_eq('80-character names and 12 colours are allowed',
  (SELECT count(*)::text FROM color_palettes WHERE user_id = '00000000-0000-4000-8000-000000052201'), '2');

-- 2b. Moodboard constraints.
SELECT pg_temp.assert_check_fails('a moodboard needs at least one image',
  $s$INSERT INTO moodboards (user_id, name, images)
     VALUES ('00000000-0000-4000-8000-000000052201', 'empty', '[]')$s$);
SELECT pg_temp.assert_check_fails('a moodboard holds at most 12 images',
  $s$INSERT INTO moodboards (user_id, name, images)
     SELECT '00000000-0000-4000-8000-000000052201', 'many',
            jsonb_agg(jsonb_build_object('url', 'https://cdn.test/' || g || '.png'))
       FROM generate_series(1, 13) g$s$);
SELECT pg_temp.assert_check_fails('images are a list',
  $s$INSERT INTO moodboards (user_id, name, images)
     VALUES ('00000000-0000-4000-8000-000000052201', 'object', '{"url":"https://cdn.test/a.png"}')$s$);
SELECT pg_temp.assert_check_fails('every image is an object',
  $s$INSERT INTO moodboards (user_id, name, images)
     VALUES ('00000000-0000-4000-8000-000000052201', 'strings', '["https://cdn.test/a.png"]')$s$);
SELECT pg_temp.assert_check_fails('every image has a url',
  $s$INSERT INTO moodboards (user_id, name, images)
     VALUES ('00000000-0000-4000-8000-000000052201', 'no url', '[{"caption":"x"}]')$s$);
SELECT pg_temp.assert_check_fails('an image url is a string',
  $s$INSERT INTO moodboards (user_id, name, images)
     VALUES ('00000000-0000-4000-8000-000000052201', 'number', '[{"url":42}]')$s$);
SELECT pg_temp.assert_check_fails('a caption, when present, is a string',
  $s$INSERT INTO moodboards (user_id, name, images)
     VALUES ('00000000-0000-4000-8000-000000052201', 'caption', '[{"url":"https://cdn.test/a.png","caption":7}]')$s$);
SELECT pg_temp.assert_check_fails('a moodboard description is at most 1000 characters',
  $s$INSERT INTO moodboards (user_id, name, description, images)
     VALUES ('00000000-0000-4000-8000-000000052201', 'long', repeat('d', 1001), '[{"url":"https://cdn.test/a.png"}]')$s$);
SELECT pg_temp.assert_check_fails('a moodboard name is at most 80 characters',
  $s$INSERT INTO moodboards (user_id, name, images)
     VALUES ('00000000-0000-4000-8000-000000052201', repeat('n', 81), '[{"url":"https://cdn.test/a.png"}]')$s$);
INSERT INTO moodboards (user_id, name, images)
  VALUES ('00000000-0000-4000-8000-000000052202', 'Other''s board', '[{"url":"https://cdn.test/o.png"}]');
SELECT pg_temp.assert_eq('a moodboard without a description or captions is allowed',
  (SELECT count(*)::text FROM moodboards WHERE user_id = '00000000-0000-4000-8000-000000052202'), '1');

-- 3. Deleting the person deletes their palettes and moodboards — and only theirs.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000052201';
SELECT pg_temp.assert_eq('the owner''s palettes are gone with the owner',
  (SELECT count(*)::text FROM color_palettes WHERE user_id = '00000000-0000-4000-8000-000000052201'), '0');
SELECT pg_temp.assert_eq('the owner''s moodboards are gone with the owner',
  (SELECT count(*)::text FROM moodboards WHERE user_id = '00000000-0000-4000-8000-000000052201'), '0');
SELECT pg_temp.assert_eq('another person''s moodboard stays',
  (SELECT count(*)::text FROM moodboards WHERE user_id = '00000000-0000-4000-8000-000000052202'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
