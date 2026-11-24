-- ============================================================================
-- Behavioral proof: the video-editor project tables (migration 703).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000f7030 upward).
--
-- #1 shape (RLS on, one owner-read policy per table, the API roles' table and
-- function privileges); #2 the owner signed in reads their own project and its
-- versions, another person reads neither, and nobody writes through the API
-- role; #3 the claim (free, live, ours, stale after 90 s, taken over); #4 save
-- (refused for invalid content, a non-holder or a stale base; a new hash
-- stores its file key, bumps the revision and returns the key it replaced; the
-- same hash only refreshes the claim); #5 release; #6 a project that is not
-- the caller's, or is deleted, is not found; #7 the integrity the backend relies on.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/editor-projects.behavior.sql mig-test:/tmp/t.sql
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

-- A statement that must be refused by a CHECK, UNIQUE, FK or NOT NULL.
CREATE FUNCTION pg_temp.assert_refused(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation OR not_null_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: the statement succeeded', label;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- A statement that must raise the given message.
CREATE FUNCTION pg_temp.assert_raises(label text, stmt text, message text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN raise_exception THEN
    got := SQLERRM;
  END;
  IF got IS DISTINCT FROM message THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: raised % expected %', label, coalesce(got, '<nothing>'), message;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000f7031', 'owner@editor-projects.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f7032', 'other@editor-projects.test', '{}', 'authenticated', 'authenticated');

-- Written as the service role would write them (as postgres here).
INSERT INTO editor_projects (id, user_id, name) VALUES
  ('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'My cut'),
  ('e0000000-0000-4000-8000-0000000f7034', '00000000-0000-4000-8000-0000000f7031', 'Deleted cut');
UPDATE editor_projects SET deleted_at = now() WHERE id = 'e0000000-0000-4000-8000-0000000f7034';
INSERT INTO editor_project_versions (project_id, number, label, author, kind, base_number, content_hash, size_bytes, blob_key) VALUES
  ('e0000000-0000-4000-8000-0000000f7033', 1, 'First pass', 'Owner', 'full', NULL, repeat('a', 64), 100, 'ver/v1'),
  ('e0000000-0000-4000-8000-0000000f7033', 2, 'Tighter', 'Owner', 'patch', 1, repeat('b', 64), 10, 'ver/v2');

SELECT pg_temp.assert_eq('a new project starts at revision 0 with no claim',
  (SELECT revision::text || '/' || coalesce(holder_id, '-') FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '0/-');

-- 1. Shape.
SELECT pg_temp.assert_eq(t || ': row level security is enabled',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace), 'true')
FROM unnest(ARRAY['editor_projects', 'editor_project_versions']) AS t;
SELECT pg_temp.assert_eq(t || ': exactly one policy, a SELECT for authenticated',
  (SELECT string_agg(cmd || ':' || array_to_string(roles, ','), ';') FROM pg_policies WHERE schemaname = 'public' AND tablename = t), 'SELECT:authenticated')
FROM unnest(ARRAY['editor_projects', 'editor_project_versions']) AS t;
SELECT pg_temp.assert_eq(t || ': anon holds no privilege',
  (has_table_privilege('anon', 'public.' || t, 'SELECT')
   OR has_table_privilege('anon', 'public.' || t, 'INSERT')
   OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
   OR has_table_privilege('anon', 'public.' || t, 'DELETE'))::text, 'false')
FROM unnest(ARRAY['editor_projects', 'editor_project_versions']) AS t;
SELECT pg_temp.assert_eq(t || ': authenticated may only read',
  (has_table_privilege('authenticated', 'public.' || t, 'SELECT')
   AND NOT has_table_privilege('authenticated', 'public.' || t, 'INSERT')
   AND NOT has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
   AND NOT has_table_privilege('authenticated', 'public.' || t, 'DELETE'))::text, 'true')
FROM unnest(ARRAY['editor_projects', 'editor_project_versions']) AS t;
SELECT pg_temp.assert_eq(f || ': executable by service_role only',
  (has_function_privilege('service_role', f, 'EXECUTE')
   AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
   AND NOT has_function_privilege('anon', f, 'EXECUTE'))::text, 'true')
FROM unnest(ARRAY[
  'public.editor_project_save(uuid, uuid, text, text, integer, text, text)',
  'public.editor_project_claim(uuid, uuid, text, boolean)',
  'public.editor_project_release(uuid, uuid, text)'
]) AS f;
SELECT pg_temp.assert_eq('the five-argument editor_project_save no longer exists',
  (to_regprocedure('public.editor_project_save(uuid, uuid, text, text, integer)') IS NULL)::text, 'true');
SELECT pg_temp.assert_eq('exactly one editor_project_save exists, the seven-argument one',
  (SELECT string_agg(oid::regprocedure::text, ';') FROM pg_proc WHERE proname = 'editor_project_save' AND pronamespace = 'public'::regnamespace),
  'editor_project_save(uuid,uuid,text,text,integer,text,text)');
SELECT pg_temp.assert_eq(p || ': SECURITY DEFINER',
  (SELECT prosecdef::text FROM pg_proc WHERE proname = p AND pronamespace = 'public'::regnamespace), 'true')
FROM unnest(ARRAY['editor_project_save', 'editor_project_claim', 'editor_project_release']) AS p;
SELECT pg_temp.assert_eq(p || ': search_path is pinned to public, pg_temp',
  (SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE proname = p AND pronamespace = 'public'::regnamespace),
  'search_path=public, pg_temp')
FROM unnest(ARRAY['editor_project_save', 'editor_project_claim', 'editor_project_release']) AS p;

-- 2. Reads through the API role.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f7031","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000f7031';
SELECT pg_temp.assert_eq('the owner reads their projects', (SELECT count(*)::text FROM editor_projects), '2');
SELECT pg_temp.assert_eq('the owner reads their versions', (SELECT count(*)::text FROM editor_project_versions), '2');
DO $$
DECLARE
  stmt text;
  denied boolean;
BEGIN
  FOREACH stmt IN ARRAY ARRAY[
    $q$INSERT INTO editor_projects (user_id, name) VALUES ('00000000-0000-4000-8000-0000000f7031', 'x')$q$,
    $q$UPDATE editor_projects SET name = 'y'$q$,
    'DELETE FROM editor_projects',
    $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 9, 'x', 'x', 'full', repeat('c', 64), 1, 'ver/vx')$q$,
    $q$UPDATE editor_project_versions SET label = 'y'$q$,
    'DELETE FROM editor_project_versions',
    $q$SELECT editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab', true)$q$
  ] LOOP
    denied := false;
    BEGIN
      EXECUTE stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'ASSERT FAIL [the owner cannot write as authenticated]: % succeeded', stmt;
    END IF;
    RAISE NOTICE 'ok  the owner cannot write as authenticated: %', left(stmt, 50);
  END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f7032","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000f7032';
SELECT pg_temp.assert_eq('another person reads no project', (SELECT count(*)::text FROM editor_projects), '0');
SELECT pg_temp.assert_eq('another person reads no version', (SELECT count(*)::text FROM editor_project_versions), '0');
RESET ROLE;

SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM editor_projects;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon is refused]: the read succeeded';
  END IF;
  RAISE NOTICE 'ok  anon is refused';
END $$;
RESET ROLE;

-- The functions, called as the backend calls them.
SET LOCAL ROLE service_role;

-- 3. The claim.
SELECT pg_temp.assert_eq('a free claim is taken',
  editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', false)::text, 'true');
SELECT pg_temp.assert_eq('the claim records its holder and when it was seen',
  (SELECT holder_id || '/' || (holder_seen_at = now())::text FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), 'tab-a/true');
SELECT pg_temp.assert_eq('a live claim is refused to another tab',
  editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-b', false)::text, 'false');
SELECT pg_temp.assert_eq('the refused tab did not take it',
  (SELECT holder_id FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), 'tab-a');
SELECT pg_temp.assert_eq('the holder claims again',
  editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', false)::text, 'true');
RESET ROLE;
UPDATE editor_projects SET holder_seen_at = now() - interval '89 seconds' WHERE id = 'e0000000-0000-4000-8000-0000000f7033';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('a claim seen 89 s ago is still live',
  editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-b', false)::text, 'false');
RESET ROLE;
UPDATE editor_projects SET holder_seen_at = now() - interval '91 seconds' WHERE id = 'e0000000-0000-4000-8000-0000000f7033';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('a claim not seen for 90 s is taken by another tab',
  editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-b', false)::text, 'true');
SELECT pg_temp.assert_eq('a takeover takes a live claim',
  editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', true)::text, 'true');
SELECT pg_temp.assert_eq('the takeover holds it now',
  (SELECT holder_id FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), 'tab-a');
SELECT pg_temp.assert_raises('a claim without a holder is refused',
  $q$SELECT editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', '', true)$q$, 'invalid_holder');

-- 4. Save. The caller writes each save's file under a new key first and
--    names it; the function returns the key it replaced.
SELECT pg_temp.assert_raises('a save by a tab that does not hold the claim is refused',
  $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-b', repeat('1', 64), 10, 'proj/k1')$q$, 'not_holder');
SELECT pg_temp.assert_eq('the refused save stored nothing',
  (SELECT revision::text || '/' || coalesce(content_hash, '-') || '/' || coalesce(blob_key, '-') FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '0/-/-');
RESET ROLE;
SELECT pg_temp.assert_raises(label, stmt, 'invalid_content')
FROM (VALUES
  ('a save without a hash is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', NULL, 10, 'proj/k1')$q$),
  ('a save with a malformed hash is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', upper(repeat('a', 64)), 10, 'proj/k1')$q$),
  ('a save with a short hash is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('a', 63), 10, 'proj/k1')$q$),
  ('a save with a negative size is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('a', 64), -1, 'proj/k1')$q$),
  ('a save without a size is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('a', 64), NULL, 'proj/k1')$q$),
  ('a save without a file key is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('a', 64), 10, NULL)$q$),
  ('a save with an empty file key is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('a', 64), 10, '')$q$),
  ('a save with a file key over 512 characters is refused',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('a', 64), 10, repeat('k', 513))$q$),
  ('invalid content is refused even from a tab that does not hold the claim',
   $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-b', NULL, 10, 'proj/k1')$q$)
) AS c(label, stmt);
SELECT pg_temp.assert_eq('the refused saves stored nothing and left the claim alone',
  (SELECT revision::text || '/' || coalesce(content_hash, '-') || '/' || coalesce(size_bytes::text, '-') || '/' || coalesce(blob_key, '-') || '/' || holder_id FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '0/-/-/-/tab-a');
-- A save based on content, against a project never saved, matches no base.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_raises('a base against a never-saved project is refused',
  $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('1', 64), 10, 'proj/k1', repeat('1', 64))$q$, 'base_mismatch');
SELECT pg_temp.assert_eq('the refused based save stored nothing',
  (SELECT revision::text || '/' || coalesce(content_hash, '-') || '/' || coalesce(blob_key, '-') FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '0/-/-');
RESET ROLE;
-- The holder always saves, however long ago it was seen.
UPDATE editor_projects SET holder_seen_at = now() - interval '1 hour' WHERE id = 'e0000000-0000-4000-8000-0000000f7033';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('a first save returns no previous file',
  (SELECT revision::text || '/' || saved::text || '/' || coalesce(previous_blob_key, '-') FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('1', 64), 10, 'proj/k1')), '1/true/-');
SELECT pg_temp.assert_eq('the save stored the hash, size and file key and refreshed the claim',
  (SELECT content_hash || '/' || size_bytes::text || '/' || blob_key || '/' || (holder_seen_at = now())::text || '/' || (updated_at = now())::text FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'),
  repeat('1', 64) || '/10/proj/k1/true/true');
RESET ROLE;
UPDATE editor_projects SET holder_seen_at = now() - interval '1 hour', updated_at = now() - interval '1 hour' WHERE id = 'e0000000-0000-4000-8000-0000000f7033';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('the same content again is not saved and replaces no file',
  (SELECT revision::text || '/' || saved::text || '/' || coalesce(previous_blob_key, '-') FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('1', 64), 10, 'proj/k1-again')), '1/false/-');
SELECT pg_temp.assert_eq('the unchanged save only refreshed the claim and kept the file key',
  (SELECT revision::text || '/' || blob_key || '/' || (holder_seen_at = now())::text || '/' || (updated_at = now())::text FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '1/proj/k1/true/false');
SELECT pg_temp.assert_eq('a save based on the current content saves, returning the file it replaced',
  (SELECT revision::text || '/' || saved::text || '/' || coalesce(previous_blob_key, '-') FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('2', 64), 20, 'proj/k2', repeat('1', 64))), '2/true/proj/k1');
SELECT pg_temp.assert_eq('the second save stored its own file key',
  (SELECT content_hash || '/' || blob_key FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), repeat('2', 64) || '/proj/k2');
SELECT pg_temp.assert_raises('a save based on older content is refused',
  $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('3', 64), 30, 'proj/k3', repeat('1', 64))$q$, 'base_mismatch');
SELECT pg_temp.assert_eq('the refused stale save changed nothing',
  (SELECT revision::text || '/' || content_hash || '/' || size_bytes::text || '/' || blob_key FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '2/' || repeat('2', 64) || '/20/proj/k2');
SELECT pg_temp.assert_eq('a save without a base still saves, returning the file it replaced',
  (SELECT revision::text || '/' || saved::text || '/' || coalesce(previous_blob_key, '-') FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('3', 64), 30, 'proj/k3')), '3/true/proj/k2');
SELECT pg_temp.assert_eq('a save with a file key of exactly 512 characters is accepted',
  (SELECT revision::text || '/' || saved::text || '/' || coalesce(previous_blob_key, '-')
   FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('4', 64), 40, repeat('k', 512))), '4/true/proj/k3');
SELECT pg_temp.assert_eq('the 512-character key is stored whole',
  (SELECT char_length(blob_key)::text FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '512');

-- 5. Release.
SELECT pg_temp.assert_eq('another tab cannot release the claim',
  editor_project_release('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-b')::text, 'false');
SELECT pg_temp.assert_eq('the claim is still held',
  (SELECT holder_id FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), 'tab-a');
SELECT pg_temp.assert_eq('the holder releases it',
  editor_project_release('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a')::text, 'true');
SELECT pg_temp.assert_eq('the released claim is clear',
  (SELECT coalesce(holder_id, '-') || '/' || coalesce(holder_seen_at::text, '-') FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '-/-');
SELECT pg_temp.assert_raises('after the release, the former holder cannot save',
  $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('3', 64), 30, 'proj/kx')$q$, 'not_holder');
SELECT pg_temp.assert_eq('a released claim is free to take',
  editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7031', 'tab-b', false)::text, 'true');

-- 6. Not the caller's, or deleted.
SELECT pg_temp.assert_raises(fn || ': another person''s project is not found', stmt, 'not_found')
FROM (VALUES
  ('save',    $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7032', 'tab-b', repeat('f', 64), 1, 'proj/kx')$q$),
  ('claim',   $q$SELECT editor_project_claim('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7032', 'tab-x', true)$q$),
  ('release', $q$SELECT editor_project_release('e0000000-0000-4000-8000-0000000f7033', '00000000-0000-4000-8000-0000000f7032', 'tab-b')$q$)
) AS c(fn, stmt);
SELECT pg_temp.assert_raises(fn || ': a deleted project is not found', stmt, 'not_found')
FROM (VALUES
  ('save',    $q$SELECT * FROM editor_project_save('e0000000-0000-4000-8000-0000000f7034', '00000000-0000-4000-8000-0000000f7031', 'tab-a', repeat('f', 64), 1, 'proj/kx')$q$),
  ('claim',   $q$SELECT editor_project_claim('e0000000-0000-4000-8000-0000000f7034', '00000000-0000-4000-8000-0000000f7031', 'tab-a', true)$q$),
  ('release', $q$SELECT editor_project_release('e0000000-0000-4000-8000-0000000f7034', '00000000-0000-4000-8000-0000000f7031', 'tab-a')$q$)
) AS c(fn, stmt);
SELECT pg_temp.assert_eq('another person''s attempt left the claim alone',
  (SELECT holder_id FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), 'tab-b');
RESET ROLE;

-- 7. Integrity the backend relies on.
SELECT pg_temp.assert_refused('an empty name is refused',
  $q$INSERT INTO editor_projects (user_id, name) VALUES ('00000000-0000-4000-8000-0000000f7031', '')$q$);
SELECT pg_temp.assert_refused('a name over 120 characters is refused',
  $q$INSERT INTO editor_projects (user_id, name) VALUES ('00000000-0000-4000-8000-0000000f7031', repeat('n', 121))$q$);
SELECT pg_temp.assert_refused('a project for nobody is refused',
  $q$INSERT INTO editor_projects (user_id, name) VALUES ('00000000-0000-4000-8000-0000000f70ff', 'x')$q$);
SELECT pg_temp.assert_refused('a version number is used once per project',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 1, 'x', 'x', 'full', repeat('c', 64), 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('a label over 120 characters is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, repeat('l', 121), 'x', 'full', repeat('c', 64), 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('an author over 60 characters is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, 'x', repeat('a', 61), 'full', repeat('c', 64), 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('an unknown kind is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, 'x', 'x', 'diff', repeat('c', 64), 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('a patch without its base is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, 'x', 'x', 'patch', repeat('c', 64), 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('a full version with a base is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, base_number, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, 'x', 'x', 'full', 1, repeat('c', 64), 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('a project hash that is not 64 lowercase hex is refused',
  $q$UPDATE editor_projects SET content_hash = 'not-a-hash' WHERE id = 'e0000000-0000-4000-8000-0000000f7033'$q$);
SELECT pg_temp.assert_refused('a negative project size is refused',
  $q$UPDATE editor_projects SET size_bytes = -1 WHERE id = 'e0000000-0000-4000-8000-0000000f7033'$q$);
SELECT pg_temp.assert_refused('an empty project file key is refused',
  $q$UPDATE editor_projects SET blob_key = '' WHERE id = 'e0000000-0000-4000-8000-0000000f7033'$q$);
SELECT pg_temp.assert_refused('a project file key over 512 characters is refused',
  $q$UPDATE editor_projects SET blob_key = repeat('k', 513) WHERE id = 'e0000000-0000-4000-8000-0000000f7033'$q$);
UPDATE editor_projects SET blob_key = repeat('j', 512) WHERE id = 'e0000000-0000-4000-8000-0000000f7033';
SELECT pg_temp.assert_eq('a project file key of exactly 512 characters is accepted by the table',
  (SELECT char_length(blob_key)::text FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033'), '512');
SELECT pg_temp.assert_refused('a version hash that is not 64 lowercase hex is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, 'x', 'x', 'full', upper(repeat('c', 64)), 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('a negative version size is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, 'x', 'x', 'full', repeat('c', 64), -1, 'ver/vx')$q$);
INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key)
VALUES ('e0000000-0000-4000-8000-0000000f7033', 3, 'x', 'x', 'full', repeat('c', 64), 0, 'ver/v3');
SELECT pg_temp.assert_eq('a well-formed version is accepted (the refusals above are not vacuous)',
  (SELECT count(*)::text FROM editor_project_versions WHERE project_id = 'e0000000-0000-4000-8000-0000000f7033' AND number = 3), '1');
SELECT pg_temp.assert_refused('a version without a hash is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 4, 'x', 'x', 'full', 1, 'ver/vx')$q$);
SELECT pg_temp.assert_refused('a version without a file key is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes) VALUES ('e0000000-0000-4000-8000-0000000f7033', 4, 'x', 'x', 'full', repeat('c', 64), 1)$q$);
SELECT pg_temp.assert_refused('an empty version file key is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 4, 'x', 'x', 'full', repeat('c', 64), 1, '')$q$);
SELECT pg_temp.assert_refused('a version file key over 512 characters is refused',
  $q$INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key) VALUES ('e0000000-0000-4000-8000-0000000f7033', 4, 'x', 'x', 'full', repeat('c', 64), 1, repeat('k', 513))$q$);
INSERT INTO editor_project_versions (project_id, number, label, author, kind, content_hash, size_bytes, blob_key)
VALUES ('e0000000-0000-4000-8000-0000000f7033', 4, 'x', 'x', 'full', repeat('c', 64), 1, repeat('k', 512));
SELECT pg_temp.assert_eq('a version file key of exactly 512 characters is accepted',
  (SELECT char_length(blob_key)::text FROM editor_project_versions WHERE project_id = 'e0000000-0000-4000-8000-0000000f7033' AND number = 4), '512');
SELECT pg_temp.assert_eq('every version stores its file key',
  (SELECT string_agg(number::text || '=' || left(blob_key, 6), ',' ORDER BY number) FROM editor_project_versions WHERE project_id = 'e0000000-0000-4000-8000-0000000f7033'), '1=ver/v1,2=ver/v2,3=ver/v3,4=kkkkkk');

DELETE FROM editor_projects WHERE id = 'e0000000-0000-4000-8000-0000000f7033';
SELECT pg_temp.assert_eq('a deleted project takes its versions with it',
  (SELECT count(*)::text FROM editor_project_versions WHERE project_id = 'e0000000-0000-4000-8000-0000000f7033'), '0');
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000f7031';
SELECT pg_temp.assert_eq('a deleted person takes their projects with them',
  (SELECT count(*)::text FROM editor_projects WHERE user_id = '00000000-0000-4000-8000-0000000f7031'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
