-- ============================================================================
-- Behavioral proof: asset_favorites and catalog_favorites are service-role only
-- and keep the rules the API relies on (migration 688).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000f6870 upward).
--
-- #2 / #3: a signed-in user (even the row's OWNER) and an anonymous caller
-- cannot read or write either table through the API roles — refused by
-- privilege, before RLS is consulted. #4 pins the integrity the backend relies
-- on: one star per person per file / option (the writes' conflict targets),
-- the lengths the routes accept, and the cascades (a deleted file or person
-- takes its stars with it). #5 proves the library's favorites predicate (its
-- functions, their grants, and that the listing one inlines); #6 the
-- per-person cap of 1000 picker options.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/asset-catalog-favorites.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-0000000f6871', 'fav-owner@favorites.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f6872', 'fav-stranger@favorites.test', '{}', 'authenticated', 'authenticated');

INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, upload_source, metadata) VALUES
  ('a0000000-0000-4000-8000-0000000f6873', '00000000-0000-4000-8000-0000000f6871', 'image', 'up.png', 'image/png', 10, 'uploads/up.png', 'https://m.test/uploads/up.png', 'manual_upload', '{}'),
  ('a0000000-0000-4000-8000-0000000f6874', '00000000-0000-4000-8000-0000000f6871', 'image', 'up2.png', 'image/png', 10, 'uploads/up2.png', 'https://m.test/uploads/up2.png', 'manual_upload', '{}');

-- 0. The proof is not vacuous: rows exist to be denied (written as the service
--    role would write them — as postgres here).
INSERT INTO asset_favorites (id, user_id, asset_id)
VALUES ('00000000-0000-4000-8000-0000000f6875', '00000000-0000-4000-8000-0000000f6871', 'a0000000-0000-4000-8000-0000000f6873');
INSERT INTO catalog_favorites (id, user_id, catalog, option_id)
VALUES ('00000000-0000-4000-8000-0000000f6876', '00000000-0000-4000-8000-0000000f6871', 'style', 'watercolor');
SELECT pg_temp.assert_eq('asset_favorites has a row (as postgres)', (SELECT count(*)::text FROM asset_favorites), '1');
SELECT pg_temp.assert_eq('catalog_favorites has a row (as postgres)', (SELECT count(*)::text FROM catalog_favorites), '1');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled on ' || t,
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace), 'true')
FROM unnest(ARRAY['asset_favorites', 'catalog_favorites']) AS t;
SELECT pg_temp.assert_eq('no policy of any kind on ' || t,
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = t), '0')
FROM unnest(ARRAY['asset_favorites', 'catalog_favorites']) AS t;
SELECT pg_temp.assert_eq(r || ' holds no privilege on ' || t,
  (has_table_privilege(r, 'public.' || t, 'SELECT')
   OR has_table_privilege(r, 'public.' || t, 'INSERT')
   OR has_table_privilege(r, 'public.' || t, 'UPDATE')
   OR has_table_privilege(r, 'public.' || t, 'DELETE'))::text, 'false')
FROM unnest(ARRAY['asset_favorites', 'catalog_favorites']) AS t, unnest(ARRAY['authenticated', 'anon']) AS r;

-- 2. The row's OWNER, signed in, cannot read or write either table through the
--    API role — refused by privilege.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f6871","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000f6871';
DO $$
DECLARE
  stmt text;
  denied boolean;
BEGIN
  FOREACH stmt IN ARRAY ARRAY[
    'SELECT count(*) FROM asset_favorites',
    $q$INSERT INTO asset_favorites (user_id, asset_id) VALUES ('00000000-0000-4000-8000-0000000f6871', 'a0000000-0000-4000-8000-0000000f6874')$q$,
    'SELECT count(*) FROM catalog_favorites',
    $q$INSERT INTO catalog_favorites (user_id, catalog, option_id) VALUES ('00000000-0000-4000-8000-0000000f6871', 'mood', 'calm')$q$
  ] LOOP
    denied := false;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'ASSERT FAIL [the owner is refused as authenticated]: % succeeded', stmt;
    END IF;
    RAISE NOTICE 'ok  the owner is refused as authenticated: %', left(stmt, 40);
  END LOOP;
END $$;
RESET ROLE;

-- 3. Anonymous is refused the same way. Clear the JWT so this is a true anon
--    read, not the previous user's claims lingering under a different role.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE
  stmt text;
  denied boolean;
BEGIN
  FOREACH stmt IN ARRAY ARRAY['SELECT count(*) FROM asset_favorites', 'SELECT count(*) FROM catalog_favorites'] LOOP
    denied := false;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'ASSERT FAIL [anon is refused]: % succeeded', stmt;
    END IF;
    RAISE NOTICE 'ok  anon is refused: %', stmt;
  END LOOP;
END $$;
RESET ROLE;

-- 4. Integrity the backend relies on.
-- 4a. One star per person per file, and per catalog option.
DO $$
DECLARE dup boolean := false;
BEGIN
  BEGIN
    INSERT INTO asset_favorites (user_id, asset_id)
    VALUES ('00000000-0000-4000-8000-0000000f6871', 'a0000000-0000-4000-8000-0000000f6873');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
  END;
  IF NOT dup THEN RAISE EXCEPTION 'ASSERT FAIL [a file is starred once per person]: the insert succeeded'; END IF;
  RAISE NOTICE 'ok  a file is starred once per person (unique_violation)';
END $$;
DO $$
DECLARE dup boolean := false;
BEGIN
  BEGIN
    INSERT INTO catalog_favorites (user_id, catalog, option_id)
    VALUES ('00000000-0000-4000-8000-0000000f6871', 'style', 'watercolor');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
  END;
  IF NOT dup THEN RAISE EXCEPTION 'ASSERT FAIL [an option is starred once per person]: the insert succeeded'; END IF;
  RAISE NOTICE 'ok  an option is starred once per person (unique_violation)';
END $$;
-- 4b. The same option id in another catalog is another star.
INSERT INTO catalog_favorites (user_id, catalog, option_id)
VALUES ('00000000-0000-4000-8000-0000000f6871', 'color-look', 'watercolor');
SELECT pg_temp.assert_eq('the same option id in another catalog is another star',
  (SELECT count(*)::text FROM catalog_favorites WHERE option_id = 'watercolor'), '2');
-- 4c. The lengths the routes accept.
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO catalog_favorites (user_id, catalog, option_id)
    VALUES ('00000000-0000-4000-8000-0000000f6871', 'style', repeat('x', 201));
  EXCEPTION WHEN check_violation THEN
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'ASSERT FAIL [an option id over 200 characters is refused]: the insert succeeded'; END IF;
  RAISE NOTICE 'ok  an option id over 200 characters is refused (check_violation)';
END $$;
-- 5. The library's favorites predicate (library_file_is_favorite, read through
--    library_assets_by_favorite and library_favorite_asset_ids): a file is a
--    favorite by its own star, or by its job's favorite while that job is out
--    of the Trash; only the person's own stars count; the rows are bounded to
--    what the person may list (their own, or a shared item).
INSERT INTO public.jobs (id, user_id, status, job_type, deleted_at) VALUES
  ('b0000000-0000-4000-8000-0000000f6881', '00000000-0000-4000-8000-0000000f6871', 'completed', 'generate-image', NULL),
  ('b0000000-0000-4000-8000-0000000f6882', '00000000-0000-4000-8000-0000000f6871', 'completed', 'generate-image', now());
INSERT INTO public.assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, upload_source, metadata, job_id, is_library_item) VALUES
  -- an upload with its own star
  ('a0000000-0000-4000-8000-0000000f6883', '00000000-0000-4000-8000-0000000f6871', 'image', 'u.png', 'image/png', 1, 'k83', 'https://m.test/83', 'manual_upload', '{}', NULL, false),
  -- made by a live job the owner favorited
  ('a0000000-0000-4000-8000-0000000f6884', '00000000-0000-4000-8000-0000000f6871', 'image', 'j.png', 'image/png', 1, 'k84', 'https://m.test/84', 'generated', '{}', 'b0000000-0000-4000-8000-0000000f6881', false),
  -- made by a job in the Trash the owner favorited
  ('a0000000-0000-4000-8000-0000000f6885', '00000000-0000-4000-8000-0000000f6871', 'image', 't.png', 'image/png', 1, 'k85', 'https://m.test/85', 'generated', '{}', 'b0000000-0000-4000-8000-0000000f6882', false),
  -- an upload nobody starred (the stranger stars it below: not the owner's star)
  ('a0000000-0000-4000-8000-0000000f6886', '00000000-0000-4000-8000-0000000f6871', 'image', 'p.png', 'image/png', 1, 'k86', 'https://m.test/86', 'manual_upload', '{}', NULL, false),
  -- the stranger's shared library item, starred by the owner
  ('a0000000-0000-4000-8000-0000000f6887', '00000000-0000-4000-8000-0000000f6872', 'image', 's.png', 'image/png', 1, 'k87', 'https://m.test/87', 'manual_upload', '{}', NULL, true),
  -- the stranger's private file, starred by the owner (a row the API would never write): out of bounds
  ('a0000000-0000-4000-8000-0000000f6888', '00000000-0000-4000-8000-0000000f6872', 'image', 'x.png', 'image/png', 1, 'k88', 'https://m.test/88', 'manual_upload', '{}', NULL, false);
INSERT INTO asset_favorites (user_id, asset_id) VALUES
  ('00000000-0000-4000-8000-0000000f6871', 'a0000000-0000-4000-8000-0000000f6883'),
  ('00000000-0000-4000-8000-0000000f6872', 'a0000000-0000-4000-8000-0000000f6886'),
  ('00000000-0000-4000-8000-0000000f6871', 'a0000000-0000-4000-8000-0000000f6887'),
  ('00000000-0000-4000-8000-0000000f6871', 'a0000000-0000-4000-8000-0000000f6888');
INSERT INTO public.gallery_favorites (user_id, job_id) VALUES
  ('00000000-0000-4000-8000-0000000f6871', 'b0000000-0000-4000-8000-0000000f6881'),
  ('00000000-0000-4000-8000-0000000f6871', 'b0000000-0000-4000-8000-0000000f6882');

CREATE TEMP VIEW fav_case_ids AS
  SELECT unnest(ARRAY[
    'a0000000-0000-4000-8000-0000000f6883', 'a0000000-0000-4000-8000-0000000f6884', 'a0000000-0000-4000-8000-0000000f6885',
    'a0000000-0000-4000-8000-0000000f6886', 'a0000000-0000-4000-8000-0000000f6887', 'a0000000-0000-4000-8000-0000000f6888'
  ]::uuid[]) AS id;

SELECT pg_temp.assert_eq('favorited=true: own star, live job''s favorite, a starred shared item',
  (SELECT string_agg(right(a.id::text, 2), ',' ORDER BY a.id)
     FROM public.library_assets_by_favorite('00000000-0000-4000-8000-0000000f6871', true) a
    WHERE a.id IN (SELECT id FROM fav_case_ids)),
  '83,84,87');
SELECT pg_temp.assert_eq('favorited=false: the trashed job''s file and the file only another person starred',
  (SELECT string_agg(right(a.id::text, 2), ',' ORDER BY a.id)
     FROM public.library_assets_by_favorite('00000000-0000-4000-8000-0000000f6871', false) a
    WHERE a.id IN (SELECT id FROM fav_case_ids)),
  '85,86');
SELECT pg_temp.assert_eq('another person''s private file is neither side (out of what the person may list)',
  (SELECT count(*)::text
     FROM (SELECT id FROM public.library_assets_by_favorite('00000000-0000-4000-8000-0000000f6871', true)
           UNION ALL
           SELECT id FROM public.library_assets_by_favorite('00000000-0000-4000-8000-0000000f6871', false)) x
    WHERE x.id = 'a0000000-0000-4000-8000-0000000f6888'),
  '0');
SELECT pg_temp.assert_eq('the flag of a page answers the same predicate',
  (SELECT string_agg(right(f::text, 2), ',' ORDER BY f)
     FROM public.library_favorite_asset_ids('00000000-0000-4000-8000-0000000f6871', ARRAY(SELECT id FROM fav_case_ids)) f
    WHERE f <> 'a0000000-0000-4000-8000-0000000f6888'),
  '83,84,87');
SELECT pg_temp.assert_eq('the stranger''s own star counts for the stranger',
  (SELECT string_agg(right(f::text, 2), ',' ORDER BY f)
     FROM public.library_favorite_asset_ids('00000000-0000-4000-8000-0000000f6872', ARRAY['a0000000-0000-4000-8000-0000000f6886']::uuid[]) f),
  '86');
-- Restoring the job from the Trash brings its favorite back.
UPDATE public.jobs SET deleted_at = NULL WHERE id = 'b0000000-0000-4000-8000-0000000f6882';
SELECT pg_temp.assert_eq('a job restored from the Trash counts again',
  public.library_file_is_favorite('00000000-0000-4000-8000-0000000f6871', 'a0000000-0000-4000-8000-0000000f6885', 'b0000000-0000-4000-8000-0000000f6882')::text,
  'true');
UPDATE public.jobs SET deleted_at = now() WHERE id = 'b0000000-0000-4000-8000-0000000f6882';

-- 5b. The functions: SECURITY INVOKER, service-role only, and the listing one
--     inlined (a SET clause or STRICT would stop that: the listing's filters,
--     order and limit then could not reach the scan of assets).
SELECT pg_temp.assert_eq(f || ' is SECURITY INVOKER',
  (SELECT (NOT prosecdef)::text FROM pg_proc WHERE proname = f AND pronamespace = 'public'::regnamespace), 'true')
FROM unnest(ARRAY['library_file_is_favorite', 'library_assets_by_favorite', 'library_favorite_asset_ids']) AS f;
SELECT pg_temp.assert_eq(r || ' may not execute ' || f,
  has_function_privilege(r, f, 'EXECUTE')::text, 'false')
FROM unnest(ARRAY[
  'public.library_file_is_favorite(uuid, uuid, uuid)',
  'public.library_assets_by_favorite(uuid, boolean)',
  'public.library_favorite_asset_ids(uuid, uuid[])'
]) AS f, unnest(ARRAY['authenticated', 'anon']) AS r;
SELECT pg_temp.assert_eq('service_role may execute ' || f,
  has_function_privilege('service_role', f, 'EXECUTE')::text, 'true')
FROM unnest(ARRAY[
  'public.library_file_is_favorite(uuid, uuid, uuid)',
  'public.library_assets_by_favorite(uuid, boolean)',
  'public.library_favorite_asset_ids(uuid, uuid[])'
]) AS f;
SELECT pg_temp.assert_eq('library_assets_by_favorite has no SET clause and is not STRICT (so it inlines)',
  (SELECT (proconfig IS NULL AND NOT proisstrict AND provolatile = 's')::text
     FROM pg_proc WHERE proname = 'library_assets_by_favorite' AND pronamespace = 'public'::regnamespace),
  'true');
DO $$
DECLARE plan text := '';
DECLARE line text;
BEGIN
  FOR line IN EXECUTE $q$EXPLAIN SELECT a.id FROM public.library_assets_by_favorite('00000000-0000-4000-8000-0000000f6871', true) a
                         WHERE a.user_id = '00000000-0000-4000-8000-0000000f6871' ORDER BY a.created_at DESC LIMIT 41$q$ LOOP
    plan := plan || line || E'\n';
  END LOOP;
  IF plan LIKE '%Function Scan%' THEN
    RAISE EXCEPTION 'ASSERT FAIL [the listing function is inlined]: %', plan;
  END IF;
  RAISE NOTICE 'ok  the listing function is inlined (no Function Scan)';
END $$;

-- 5c. Called the way the API calls it: as service_role.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('service_role reads the favorites through the function',
  (SELECT count(*)::text FROM public.library_assets_by_favorite('00000000-0000-4000-8000-0000000f6871', true) a
    WHERE a.id::text LIKE 'a0000000-0000-4000-8000-0000000f688_'),
  '3');
RESET ROLE;

-- 6. At most 1000 favorite picker options per person, held by the database.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000f6889', 'fav-cap@favorites.test', '{}', 'authenticated', 'authenticated');
INSERT INTO catalog_favorites (user_id, catalog, option_id)
SELECT '00000000-0000-4000-8000-0000000f6889', 'style', 'opt-' || n FROM generate_series(1, 1000) AS n;
SELECT pg_temp.assert_eq('a person can keep 1000 options',
  (SELECT count(*)::text FROM catalog_favorites WHERE user_id = '00000000-0000-4000-8000-0000000f6889'), '1000');
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO catalog_favorites (user_id, catalog, option_id)
    VALUES ('00000000-0000-4000-8000-0000000f6889', 'style', 'one-too-many');
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'catalog_favorites_per_user_cap' THEN RAISE; END IF;
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'ASSERT FAIL [the 1001st option is refused]: the insert succeeded'; END IF;
  RAISE NOTICE 'ok  the 1001st option is refused (check_violation catalog_favorites_per_user_cap)';
END $$;
-- Starring one already starred, at the cap, is still the no-op success the API writes (ON CONFLICT DO NOTHING).
INSERT INTO catalog_favorites (user_id, catalog, option_id)
VALUES ('00000000-0000-4000-8000-0000000f6889', 'style', 'opt-7')
ON CONFLICT (user_id, catalog, option_id) DO NOTHING;
SELECT pg_temp.assert_eq('re-starring at the cap changes nothing',
  (SELECT count(*)::text FROM catalog_favorites WHERE user_id = '00000000-0000-4000-8000-0000000f6889'), '1000');
-- Unstarring one makes room again.
DELETE FROM catalog_favorites WHERE user_id = '00000000-0000-4000-8000-0000000f6889' AND option_id = 'opt-1';
INSERT INTO catalog_favorites (user_id, catalog, option_id) VALUES ('00000000-0000-4000-8000-0000000f6889', 'mood', 'calm');
SELECT pg_temp.assert_eq('a freed place takes a new option',
  (SELECT count(*)::text FROM catalog_favorites WHERE user_id = '00000000-0000-4000-8000-0000000f6889'), '1000');
-- Another person's count is their own.
INSERT INTO catalog_favorites (user_id, catalog, option_id) VALUES ('00000000-0000-4000-8000-0000000f6871', 'mood', 'calm');
SELECT pg_temp.assert_eq('the cap is per person',
  (SELECT count(*)::text FROM catalog_favorites WHERE user_id = '00000000-0000-4000-8000-0000000f6871' AND option_id = 'calm'), '1');
SELECT pg_temp.assert_eq('the cap trigger function is SECURITY INVOKER with a fixed search_path',
  (SELECT (NOT prosecdef AND proconfig = ARRAY['search_path=""'])::text
     FROM pg_proc WHERE proname = 'catalog_favorites_enforce_cap' AND pronamespace = 'public'::regnamespace),
  'true');

-- 4d. A deleted file takes its stars with it.
DELETE FROM public.assets WHERE id = 'a0000000-0000-4000-8000-0000000f6873';
SELECT pg_temp.assert_eq('deleting the file cascades to its stars',
  (SELECT count(*)::text FROM asset_favorites WHERE asset_id = 'a0000000-0000-4000-8000-0000000f6873'), '0');
-- 4e. Deleting the person removes their stars; another person's stay.
INSERT INTO catalog_favorites (user_id, catalog, option_id)
VALUES ('00000000-0000-4000-8000-0000000f6872', 'style', 'watercolor');
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000f6871';
SELECT pg_temp.assert_eq('deleting the user cascades to their catalog favorites',
  (SELECT count(*)::text FROM catalog_favorites WHERE user_id = '00000000-0000-4000-8000-0000000f6871'), '0');
SELECT pg_temp.assert_eq('another person''s favorites are untouched',
  (SELECT count(*)::text FROM catalog_favorites WHERE user_id = '00000000-0000-4000-8000-0000000f6872'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
