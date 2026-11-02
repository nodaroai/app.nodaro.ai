-- ============================================================================
-- Behavioral proof: content restrictions (migration 581).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000951 upward).
--
-- WHY THIS PROOF EXISTS. A restriction is of the bytes: `restrict_content`
-- must mark, in one transaction, the file named, every copy of it (by key
-- and by hash), the job that made it and the job's own output rows, and
-- move the job's output aside; an unfinished job must be refused; every
-- marked row must be invisible to its owner and to everyone else who reads
-- the tables directly, and visible to an admin; the moved-aside output must
-- be unreadable to `authenticated` by the column grant; a lift must restore
-- every row exactly, once, without overwriting an output written since; the
-- record is never deleted, its lift is its one change, and it outlives the
-- rows it points at.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/content-restrictions.behavior.sql mig-test:/tmp/t.sql
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

-- Runs a statement that must fail, and answers the SQLSTATE it failed with.
CREATE FUNCTION pg_temp.expect_error(label text, stmt text, want_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> want_state THEN
      RAISE EXCEPTION 'ASSERT FAIL [%]: failed with % (%) expected %', label, SQLSTATE, SQLERRM, want_state;
    END IF;
    RAISE NOTICE 'ok  %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERT FAIL [%]: did not fail', label;
END $$;

-- Reads a table as a signed-in account would, through the policies.
CREATE FUNCTION pg_temp.as_user(who uuid, q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', who::text, true);
  EXECUTE q INTO out;
  EXECUTE 'RESET ROLE';
  RETURN out;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RAISE;
END $$;

-- An owner, another person who saved a copy, and an admin.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000951', 'cr-owner@cr.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000952', 'cr-other@cr.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000953', 'cr-admin@cr.test', '{}', 'authenticated', 'authenticated');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000000953';

-- The job, its output row (the worker's, naming the job), a copy another
-- account saved (same key), and an unrelated file with the same bytes (same hash).
INSERT INTO jobs (id, user_id, job_type, status, is_public, output_data)
VALUES ('00000000-0000-4000-8000-000000000955', '00000000-0000-4000-8000-000000000951', 'generate-image', 'completed', true,
        '{"imageUrl": "https://cdn.example.test/00000000-0000-4000-8000-000000000955.png"}'::jsonb);
INSERT INTO assets (id, user_id, job_id, type, filename, mime_type, size_bytes, r2_key, r2_url, content_hash, is_library_item, is_shared)
VALUES ('00000000-0000-4000-8000-000000000954', '00000000-0000-4000-8000-000000000951', '00000000-0000-4000-8000-000000000955', 'image', 'a.png', 'image/png', 10,
        '00000000-0000-4000-8000-000000000955.png', 'https://cdn.example.test/00000000-0000-4000-8000-000000000955.png', '1111111111111111111111111111111111111111111111111111111111111111', true, true),
       ('00000000-0000-4000-8000-000000000958', '00000000-0000-4000-8000-000000000952', NULL, 'image', 'copy.png', 'image/png', 10,
        '00000000-0000-4000-8000-000000000955.png', 'https://cdn.example.test/00000000-0000-4000-8000-000000000955.png', NULL, false, false),
       ('00000000-0000-4000-8000-000000000959', '00000000-0000-4000-8000-000000000952', NULL, 'image', 'same-bytes.png', 'image/png', 10,
        'uploads/same-bytes.png', 'https://cdn.example.test/uploads/same-bytes.png', '1111111111111111111111111111111111111111111111111111111111111111', false, false),
       ('00000000-0000-4000-8000-000000000960', '00000000-0000-4000-8000-000000000952', NULL, 'image', 'unrelated.png', 'image/png', 10,
        'uploads/unrelated.png', 'https://cdn.example.test/uploads/unrelated.png', '2222222222222222222222222222222222222222222222222222222222222222', true, false);
INSERT INTO jobs (id, user_id, job_type, status, is_public, output_data)
VALUES ('00000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000951', 'generate-image', 'processing', false, NULL);

-- 1. Before: another person sees the shared file and the public job's output.
SELECT pg_temp.assert_eq('before: another person sees the shared file',
  pg_temp.as_user('00000000-0000-4000-8000-000000000952', $q$SELECT count(*)::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000954'$q$), '1');
SELECT pg_temp.assert_eq('before: another person sees the public job''s output',
  pg_temp.as_user('00000000-0000-4000-8000-000000000952', $q$SELECT (output_data IS NOT NULL)::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000000955'$q$), 'true');

-- 2. The function refuses a nameless call, an unknown row, and an unfinished job.
SELECT pg_temp.expect_error('restrict_content needs a file or a job',
  $q$SELECT restrict_content(NULL, NULL, '{}', NULL, NULL, NULL, 'x', NULL, NULL)$q$, '22023');
SELECT pg_temp.expect_error('restrict_content refuses an unknown file',
  $q$SELECT restrict_content('00000000-0000-4000-8000-000000000999', NULL, '{}', NULL, NULL, NULL, 'x', NULL, NULL)$q$, 'P0002');
SELECT pg_temp.expect_error('restrict_content refuses a job that is not finished',
  $q$SELECT restrict_content(NULL, '00000000-0000-4000-8000-000000000961', '{}', NULL, NULL, NULL, 'x', NULL, NULL)$q$, '55P03');
SELECT pg_temp.expect_error('restrict_content refuses an unknown complaint',
  $q$SELECT restrict_content('00000000-0000-4000-8000-000000000954', NULL, '{}', NULL, NULL, NULL, 'x', '00000000-0000-4000-8000-000000000999', NULL)$q$, '23503');

-- 3. Restricting the file marks it, its copy by key, its copy by hash, and the job that made it; the unrelated file is untouched.
SELECT pg_temp.assert_eq('restrict_content answers the record covering every row',
  (SELECT (asset_id = '00000000-0000-4000-8000-000000000954')::text || ',' || cardinality(asset_ids)::text || ',' || cardinality(job_ids)::text
     FROM restrict_content('00000000-0000-4000-8000-000000000954', NULL, '{00000000-0000-4000-8000-000000000955.png}', '1111111111111111111111111111111111111111111111111111111111111111',
                           'https://youtube.com/watch?v=x', '00000000-0000-4000-8000-000000000951', 'complaint', NULL, '00000000-0000-4000-8000-000000000953')), 'true,3,1');
SELECT pg_temp.assert_eq('the file, its copies and the job are marked; the unrelated file is not',
  (SELECT string_agg(id::text || '=' || (restricted_at IS NOT NULL)::text, ',' ORDER BY id) FROM assets WHERE id IN
     ('00000000-0000-4000-8000-000000000954', '00000000-0000-4000-8000-000000000958', '00000000-0000-4000-8000-000000000959', '00000000-0000-4000-8000-000000000960')),
  '00000000-0000-4000-8000-000000000954=true,00000000-0000-4000-8000-000000000958=true,00000000-0000-4000-8000-000000000959=true,00000000-0000-4000-8000-000000000960=false');
SELECT pg_temp.assert_eq('the shares are off',
  (SELECT (is_shared OR is_library_item)::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000954'), 'false');
SELECT pg_temp.assert_eq('the job''s output is moved aside and the job unpublished',
  (SELECT (output_data IS NULL)::text || ',' || (restricted_output_data -> 'output_data' ->> 'imageUrl') || ',' || is_public::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000000955'),
  'true,https://cdn.example.test/00000000-0000-4000-8000-000000000955.png,false');
SELECT pg_temp.expect_error('restricting again is refused',
  $q$SELECT restrict_content('00000000-0000-4000-8000-000000000954', NULL, '{}', NULL, NULL, NULL, 'x', NULL, NULL)$q$, '23505');
SELECT pg_temp.assert_eq('one record, with what every row was',
  (SELECT count(*)::text || ',' || (prior -> 'assets' -> '00000000-0000-4000-8000-000000000954' ->> 'is_shared') || ',' || (prior -> 'jobs' -> '00000000-0000-4000-8000-000000000955' ->> 'is_public')
     FROM content_restrictions WHERE lifted_at IS NULL GROUP BY prior), '1,true,true');

-- 4. After: the owner and the other person see nothing; an admin sees the rows; the moved-aside column is not theirs to read.
SELECT pg_temp.assert_eq('after: the owner cannot see the restricted file',
  pg_temp.as_user('00000000-0000-4000-8000-000000000951', $q$SELECT count(*)::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000954'$q$), '0');
SELECT pg_temp.assert_eq('after: the owner cannot see the restricted job',
  pg_temp.as_user('00000000-0000-4000-8000-000000000951', $q$SELECT count(*)::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000000955'$q$), '0');
SELECT pg_temp.assert_eq('after: the other person cannot see their own copy',
  pg_temp.as_user('00000000-0000-4000-8000-000000000952', $q$SELECT count(*)::text FROM assets WHERE id IN ('00000000-0000-4000-8000-000000000958', '00000000-0000-4000-8000-000000000959')$q$), '0');
SELECT pg_temp.assert_eq('after: an admin still sees the file',
  pg_temp.as_user('00000000-0000-4000-8000-000000000953', $q$SELECT count(*)::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000954'$q$), '1');
SELECT pg_temp.expect_error('the moved-aside output is not a column authenticated may read',
  $q$SELECT pg_temp.as_user('00000000-0000-4000-8000-000000000951', 'SELECT count(restricted_output_data)::text FROM jobs')$q$, '42501');
SELECT pg_temp.expect_error('the records are not readable through PostgREST',
  $q$SELECT pg_temp.as_user('00000000-0000-4000-8000-000000000951', 'SELECT count(*)::text FROM content_restrictions')$q$, '42501');
SELECT pg_temp.expect_error('the functions are not callable through PostgREST',
  $q$SELECT pg_temp.as_user('00000000-0000-4000-8000-000000000953', 'SELECT (lift_content_restriction(id, NULL, NULL)).id::text FROM content_restrictions LIMIT 1')$q$, '42501');

-- 5. The record: never deleted, never truncated, its one change the lift.
SELECT pg_temp.expect_error('a restriction cannot be deleted',
  $q$DELETE FROM content_restrictions$q$, '55000');
SELECT pg_temp.expect_error('a restriction''s reason cannot be edited',
  $q$UPDATE content_restrictions SET reason = 'other'$q$, '55000');
SELECT pg_temp.expect_error('a lift cannot be given a reason without lifting',
  $q$UPDATE content_restrictions SET lift_reason = 'x'$q$, '55000');
SELECT pg_temp.expect_error('the records cannot be truncated',
  $q$TRUNCATE content_restrictions$q$, '55000');

-- 6. The lift restores every row exactly, once; an output written since is kept.
UPDATE jobs SET output_data = '{"imageUrl": "https://cdn.example.test/newer.png"}'::jsonb WHERE id = '00000000-0000-4000-8000-000000000955';
SELECT pg_temp.assert_eq('lift_content_restriction answers the lifted record',
  (SELECT (lifted_at IS NOT NULL)::text || ',' || lift_reason FROM lift_content_restriction((SELECT id FROM content_restrictions LIMIT 1), '00000000-0000-4000-8000-000000000953', 'counter-notice')), 'true,counter-notice');
SELECT pg_temp.assert_eq('the file and its copies are restored, shares included',
  (SELECT string_agg(id::text || '=' || (restricted_at IS NULL)::text || '/' || is_shared::text || '/' || is_library_item::text, ',' ORDER BY id) FROM assets WHERE id IN
     ('00000000-0000-4000-8000-000000000954', '00000000-0000-4000-8000-000000000958')),
  '00000000-0000-4000-8000-000000000954=true/true/true,00000000-0000-4000-8000-000000000958=true/false/false');
SELECT pg_temp.assert_eq('the job is restored and published, and the output written since is kept',
  (SELECT (restricted_at IS NULL)::text || ',' || is_public::text || ',' || (output_data ->> 'imageUrl') || ',' || (restricted_output_data IS NULL)::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000000955'),
  'true,true,https://cdn.example.test/newer.png,true');
SELECT pg_temp.expect_error('a second lift is refused',
  $q$SELECT lift_content_restriction((SELECT id FROM content_restrictions LIMIT 1), NULL, NULL)$q$, '23505');
SELECT pg_temp.expect_error('a lift''s reason cannot be edited afterwards',
  $q$UPDATE content_restrictions SET lift_reason = 'changed'$q$, '55000');
SELECT pg_temp.expect_error('a lift cannot be undone',
  $q$UPDATE content_restrictions SET lifted_at = NULL$q$, '55000');
SELECT pg_temp.assert_eq('after the lift: the other person sees the shared file again',
  pg_temp.as_user('00000000-0000-4000-8000-000000000952', $q$SELECT count(*)::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000954'$q$), '1');

-- 7. A job restricted by name takes its own output rows along, and its held output.
UPDATE jobs SET status = 'pending_review', held_output_data = '{"imageUrl": "https://cdn.example.test/00000000-0000-4000-8000-000000000955.png"}'::jsonb, output_data = NULL
  WHERE id = '00000000-0000-4000-8000-000000000955';
SELECT pg_temp.assert_eq('restricting the job covers its output row and the copy by key',
  (SELECT cardinality(asset_ids)::text || ',' || cardinality(job_ids)::text
     FROM restrict_content(NULL, '00000000-0000-4000-8000-000000000955', '{00000000-0000-4000-8000-000000000955.png}', NULL, NULL,
                           '00000000-0000-4000-8000-000000000951', 'complaint two', NULL, '00000000-0000-4000-8000-000000000953')), '2,1');
SELECT pg_temp.assert_eq('the held output is moved aside too',
  (SELECT (held_output_data IS NULL)::text || ',' || (restricted_output_data -> 'held_output_data' ->> 'imageUrl' IS NOT NULL)::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000000955'), 'true,true');

-- 8. The record outlives the rows it points at. While a restriction stands
--    its rows are held (migration 582), so the second one is lifted first.
SELECT pg_temp.expect_error('a restricted row is held while the restriction stands',
  $q$DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000000955'$q$, '55000');
SELECT lift_content_restriction((SELECT id FROM content_restrictions WHERE lifted_at IS NULL), NULL, 'lifted');
DELETE FROM assets WHERE id = '00000000-0000-4000-8000-000000000954';
DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000000955';
-- The first record names the copy's key too (582: every marked row's key is on the record).
SELECT pg_temp.assert_eq('the records stay when their rows are gone, with the keys they named',
  (SELECT count(*)::text || ',' || count(*) FILTER (WHERE job_id IS NULL AND asset_id IS NULL)::text || ',' || string_agg(DISTINCT array_to_string(r2_keys, ','), ';')
     FROM content_restrictions), '2,2,00000000-0000-4000-8000-000000000955.png;00000000-0000-4000-8000-000000000955.png,uploads/same-bytes.png');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
