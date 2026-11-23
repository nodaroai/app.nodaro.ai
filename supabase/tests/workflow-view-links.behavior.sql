-- ============================================================================
-- Behavioral proof: workflow_view_links is service-role only and keeps the
-- rules the API relies on (migration 691).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000f6910 upward).
--
-- #1 shape (RLS on, no policies, no privilege for the API roles); #2 / #3 the
-- workflow's OWNER signed in, and an anonymous caller, cannot read or write
-- the table (refused by privilege, before RLS); #4 the integrity the backend
-- relies on: one link per workflow, a unique well-formed token, a saved copy
-- stored whole or not at all, the language's shape, and the cascades (a
-- deleted workflow or person takes the link with it).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/workflow-view-links.behavior.sql mig-test:/tmp/t.sql
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

-- An insert that must be refused by a CHECK, UNIQUE or FK.
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000f6911', 'view-owner@view-links.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-0000000f6912', '00000000-0000-4000-8000-0000000f6911', 'View Project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-0000000f6913', 'c0000000-0000-4000-8000-0000000f6912', '00000000-0000-4000-8000-0000000f6911', 'Viewed'),
  ('d0000000-0000-4000-8000-0000000f6914', 'c0000000-0000-4000-8000-0000000f6912', '00000000-0000-4000-8000-0000000f6911', 'Second');

-- 0. The proof is not vacuous: a row exists to be denied (written as the
--    service role would write it — as postgres here).
INSERT INTO workflow_view_links (workflow_id, owner_id, token)
VALUES ('d0000000-0000-4000-8000-0000000f6913', '00000000-0000-4000-8000-0000000f6911', repeat('A', 43));
SELECT pg_temp.assert_eq('workflow_view_links has a row (as postgres)', (SELECT count(*)::text FROM workflow_view_links), '1');
SELECT pg_temp.assert_eq('a new link is indexable by default', (SELECT indexable::text FROM workflow_view_links), 'true');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'workflow_view_links' AND relnamespace = 'public'::regnamespace), 'true');
SELECT pg_temp.assert_eq('no policy of any kind',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_view_links'), '0');
SELECT pg_temp.assert_eq(r || ' holds no privilege',
  (has_table_privilege(r, 'public.workflow_view_links', 'SELECT')
   OR has_table_privilege(r, 'public.workflow_view_links', 'INSERT')
   OR has_table_privilege(r, 'public.workflow_view_links', 'UPDATE')
   OR has_table_privilege(r, 'public.workflow_view_links', 'DELETE'))::text, 'false')
FROM unnest(ARRAY['authenticated', 'anon']) AS r;

-- 2. The workflow's OWNER, signed in, cannot read or write the table through
--    the API role — refused by privilege.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f6911","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000f6911';
DO $$
DECLARE
  stmt text;
  denied boolean;
BEGIN
  FOREACH stmt IN ARRAY ARRAY[
    'SELECT token FROM workflow_view_links',
    $q$INSERT INTO workflow_view_links (workflow_id, owner_id, token) VALUES ('d0000000-0000-4000-8000-0000000f6914', '00000000-0000-4000-8000-0000000f6911', repeat('B', 43))$q$,
    'UPDATE workflow_view_links SET indexable = false',
    'DELETE FROM workflow_view_links'
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

-- 3. Anonymous is refused the same way.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM token FROM workflow_view_links;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon is refused]: the read succeeded';
  END IF;
  RAISE NOTICE 'ok  anon is refused';
END $$;
RESET ROLE;

-- 4. Integrity the backend relies on.
SELECT pg_temp.assert_refused('one link per workflow',
  $q$INSERT INTO workflow_view_links (workflow_id, owner_id, token) VALUES ('d0000000-0000-4000-8000-0000000f6913', '00000000-0000-4000-8000-0000000f6911', repeat('C', 43))$q$);
SELECT pg_temp.assert_refused('a token names one link',
  $q$INSERT INTO workflow_view_links (workflow_id, owner_id, token) VALUES ('d0000000-0000-4000-8000-0000000f6914', '00000000-0000-4000-8000-0000000f6911', repeat('A', 43))$q$);
SELECT pg_temp.assert_refused('a token of another shape is refused',
  $q$INSERT INTO workflow_view_links (workflow_id, owner_id, token) VALUES ('d0000000-0000-4000-8000-0000000f6914', '00000000-0000-4000-8000-0000000f6911', 'short')$q$);
SELECT pg_temp.assert_refused('a language of another shape is refused',
  $q$INSERT INTO workflow_view_links (workflow_id, owner_id, token, locale) VALUES ('d0000000-0000-4000-8000-0000000f6914', '00000000-0000-4000-8000-0000000f6911', repeat('D', 43), 'english')$q$);
SELECT pg_temp.assert_refused('a saved copy without its time is refused',
  $q$INSERT INTO workflow_view_links (workflow_id, owner_id, token, export_snapshot, export_includes_assets) VALUES ('d0000000-0000-4000-8000-0000000f6914', '00000000-0000-4000-8000-0000000f6911', repeat('E', 43), '{}', false)$q$);
SELECT pg_temp.assert_refused('a time without a saved copy is refused',
  $q$INSERT INTO workflow_view_links (workflow_id, owner_id, token, exported_at) VALUES ('d0000000-0000-4000-8000-0000000f6914', '00000000-0000-4000-8000-0000000f6911', repeat('F', 43), now())$q$);

INSERT INTO workflow_view_links (workflow_id, owner_id, token, locale, export_snapshot, export_includes_assets, exported_at)
VALUES ('d0000000-0000-4000-8000-0000000f6914', '00000000-0000-4000-8000-0000000f6911', repeat('G', 43), 'pt-BR', '{"version":1}', true, now());
SELECT pg_temp.assert_eq('a whole saved copy is kept', (SELECT count(*)::text FROM workflow_view_links WHERE export_snapshot IS NOT NULL), '1');

DELETE FROM workflows WHERE id = 'd0000000-0000-4000-8000-0000000f6913';
SELECT pg_temp.assert_eq('a deleted workflow takes its link', (SELECT count(*)::text FROM workflow_view_links WHERE workflow_id = 'd0000000-0000-4000-8000-0000000f6913'), '0');
DELETE FROM workflows WHERE id = 'd0000000-0000-4000-8000-0000000f6914';
SELECT pg_temp.assert_eq('no link is left', (SELECT count(*)::text FROM workflow_view_links), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
