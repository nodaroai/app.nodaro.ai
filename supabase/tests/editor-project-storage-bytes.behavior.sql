-- ============================================================================
-- Behavioral proof: editor_project_storage_bytes (migration 711).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000f7070 upward).
--
-- #1 shape (SECURITY DEFINER, STABLE, the exact pinned search_path, executable
-- by service_role only, refused to anon and authenticated when called); #2
-- what it counts (current files plus versions of live projects; never a
-- deleted project, never another person's; 0 for a person with nothing).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/editor-project-storage-bytes.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-0000000f7071', 'owner@editor-storage.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f7072', 'other@editor-storage.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f7073', 'empty@editor-storage.test', '{}', 'authenticated', 'authenticated');

-- The owner: a saved project (1000) with two versions (300 + 20), a never-saved
-- project (null size) with one version (5), and a deleted project (7000) with a
-- version (900). The other person: a project (50000) with a version (60000).
INSERT INTO editor_projects (id, user_id, name, content_hash, size_bytes, blob_key) VALUES
  ('e0000000-0000-4000-8000-0000000f7074', '00000000-0000-4000-8000-0000000f7071', 'Saved', repeat('a', 64), 1000, 'k/current'),
  ('e0000000-0000-4000-8000-0000000f7075', '00000000-0000-4000-8000-0000000f7071', 'Never saved', NULL, NULL, NULL),
  ('e0000000-0000-4000-8000-0000000f7076', '00000000-0000-4000-8000-0000000f7071', 'Deleted', repeat('b', 64), 7000, 'k/deleted'),
  ('e0000000-0000-4000-8000-0000000f7077', '00000000-0000-4000-8000-0000000f7072', 'Theirs', repeat('c', 64), 50000, 'k/theirs');
UPDATE editor_projects SET deleted_at = now() WHERE id = 'e0000000-0000-4000-8000-0000000f7076';
INSERT INTO editor_project_versions (project_id, number, label, author, kind, base_number, content_hash, size_bytes, blob_key) VALUES
  ('e0000000-0000-4000-8000-0000000f7074', 1, 'One', 'you', 'full', NULL, repeat('d', 64), 300, 'k/v1'),
  ('e0000000-0000-4000-8000-0000000f7074', 2, 'Two', 'you', 'patch', 1, repeat('e', 64), 20, 'k/v2'),
  ('e0000000-0000-4000-8000-0000000f7075', 1, 'One', 'you', 'full', NULL, repeat('f', 64), 5, 'k/v3'),
  ('e0000000-0000-4000-8000-0000000f7076', 1, 'One', 'you', 'full', NULL, repeat('0', 64), 900, 'k/v4'),
  ('e0000000-0000-4000-8000-0000000f7077', 1, 'One', 'you', 'full', NULL, repeat('1', 64), 60000, 'k/v5');

-- 1. Shape.
SELECT pg_temp.assert_eq('editor_project_storage_bytes: one function, taking a uuid',
  (SELECT string_agg(oid::regprocedure::text, ';') FROM pg_proc WHERE proname = 'editor_project_storage_bytes' AND pronamespace = 'public'::regnamespace),
  'editor_project_storage_bytes(uuid)');
SELECT pg_temp.assert_eq('editor_project_storage_bytes: returns bigint',
  (SELECT prorettype::regtype::text FROM pg_proc WHERE proname = 'editor_project_storage_bytes' AND pronamespace = 'public'::regnamespace), 'bigint');
SELECT pg_temp.assert_eq('editor_project_storage_bytes: SECURITY DEFINER and STABLE',
  (SELECT prosecdef::text || '/' || provolatile::text FROM pg_proc WHERE proname = 'editor_project_storage_bytes' AND pronamespace = 'public'::regnamespace), 'true/s');
SELECT pg_temp.assert_eq('editor_project_storage_bytes: search_path is pinned to public, pg_temp',
  (SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE proname = 'editor_project_storage_bytes' AND pronamespace = 'public'::regnamespace),
  'search_path=public, pg_temp');
SELECT pg_temp.assert_eq('editor_project_storage_bytes: executable by service_role only',
  (has_function_privilege('service_role', 'public.editor_project_storage_bytes(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.editor_project_storage_bytes(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.editor_project_storage_bytes(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('public', 'public.editor_project_storage_bytes(uuid)', 'EXECUTE'))::text, 'true');

-- The grants from the caller's side: the API roles are refused the call, the service role makes it.
DO $$
DECLARE
  r text;
  denied boolean;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    denied := false;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      PERFORM public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f7071');
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    RESET ROLE;
    IF NOT denied THEN
      RAISE EXCEPTION 'ASSERT FAIL [% may not call editor_project_storage_bytes]: the call succeeded', r;
    END IF;
    RAISE NOTICE 'ok  % may not call editor_project_storage_bytes', r;
  END LOOP;
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('the service role calls it',
  public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f7071')::text, '1325');
RESET ROLE;

-- 2. What it counts.
SELECT pg_temp.assert_eq('the owner: live current files plus their versions (1000 + 300 + 20 + 5), never the deleted project',
  public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f7071')::text, '1325');
SELECT pg_temp.assert_eq('the other person counts only their own (50000 + 60000)',
  public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f7072')::text, '110000');
SELECT pg_temp.assert_eq('a person with no projects holds 0',
  public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f7073')::text, '0');
SELECT pg_temp.assert_eq('a person who does not exist holds 0',
  public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f70ff')::text, '0');

UPDATE editor_projects SET deleted_at = now() WHERE id = 'e0000000-0000-4000-8000-0000000f7074';
SELECT pg_temp.assert_eq('deleting a project stops its file and versions counting',
  public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f7071')::text, '5');
UPDATE editor_projects SET size_bytes = 2147483647 WHERE id = 'e0000000-0000-4000-8000-0000000f7077';
SELECT pg_temp.assert_eq('the sum is bigint: no overflow past an integer',
  public.editor_project_storage_bytes('00000000-0000-4000-8000-0000000f7072')::text, (2147483647::bigint + 60000)::text);

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
