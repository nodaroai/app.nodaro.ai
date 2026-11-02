-- ============================================================================
-- Behavioral proof: the legal hold (migration 582).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000941 upward).
--
-- WHY THIS PROOF EXISTS. Evidence is never deleted: a file under an active
-- restriction, or matched to an open complaint case, must refuse its
-- deletion and the loss of its key; a restricted job must refuse its
-- deletion; the storage layer's question must name exactly the held keys;
-- an account under hold must answer so; and every hold must END when the
-- case closes or the restriction is lifted, or the hold is a trap.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/legal-hold.behavior.sql mig-test:/tmp/t.sql
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

CREATE FUNCTION pg_temp.as_role(r text, q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', r);
  EXECUTE q INTO out;
  EXECUTE 'RESET ROLE';
  RETURN out;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RAISE;
END $$;

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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000941', 'lh-owner@cr.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000942', 'lh-free@cr.test', '{}', 'authenticated', 'authenticated');

-- A restricted file (and its job) with a copy of the same bytes under another
-- key, a file a verified open complaint matches, a free file an UNVERIFIED
-- complaint names, and a free file.
INSERT INTO jobs (id, user_id, job_type, status, is_public, output_data)
VALUES ('00000000-0000-4000-8000-000000000945', '00000000-0000-4000-8000-000000000941', 'generate-image', 'completed', true,
        '{"imageUrl": "https://cdn.example.test/00000000-0000-4000-8000-000000000945.png"}'::jsonb);
INSERT INTO assets (id, user_id, job_id, type, filename, mime_type, size_bytes, r2_key, r2_url, content_hash)
VALUES ('00000000-0000-4000-8000-000000000943', '00000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000945', 'image', 'a.png', 'image/png', 10,
        '00000000-0000-4000-8000-000000000945.png', 'https://cdn.example.test/00000000-0000-4000-8000-000000000945.png',
        repeat('a', 64)),
       ('00000000-0000-4000-8000-000000000949', '00000000-0000-4000-8000-000000000942', NULL, 'image', 'copy.png', 'image/png', 10,
        'uploads/copy-of-a.png', 'https://cdn.example.test/uploads/copy-of-a.png', repeat('a', 64)),
       ('00000000-0000-4000-8000-000000000944', '00000000-0000-4000-8000-000000000941', NULL, 'image', 'evidence.png', 'image/png', 10,
        'uploads/evidence.png', 'https://cdn.example.test/uploads/evidence.png', NULL),
       ('00000000-0000-4000-8000-000000000946', '00000000-0000-4000-8000-000000000942', NULL, 'image', 'free.png', 'image/png', 10,
        'uploads/free.png', 'https://cdn.example.test/uploads/free.png', NULL);
SELECT restrict_content('00000000-0000-4000-8000-000000000943', NULL, '{00000000-0000-4000-8000-000000000945.png}', repeat('a', 64), NULL,
                        '00000000-0000-4000-8000-000000000941', 'complaint', NULL, NULL);
INSERT INTO rights_complaints (id, kind, category, complainant_name_enc, complainant_email_enc, complainant_email_hash, reported_content, explanation, matched_asset_ids, verified_at)
VALUES ('00000000-0000-4000-8000-000000000947', 'other', 'privacy', 'enc', 'enc', 'hash-lh', 'somewhere', 'what happened',
        '{00000000-0000-4000-8000-000000000944}', now()),
       ('00000000-0000-4000-8000-000000000948', 'other', 'privacy', 'enc', 'enc', 'hash-lh2', 'somewhere', 'never verified',
        '{00000000-0000-4000-8000-000000000946}', NULL);

-- 0. The restriction names every copy's key, not only the one the caller read.
SELECT pg_temp.assert_eq('a restriction by hash carries the copy''s key too',
  (SELECT array_to_string(r2_keys, ',') FROM content_restrictions WHERE lifted_at IS NULL),
  '00000000-0000-4000-8000-000000000945.png,uploads/copy-of-a.png');

-- 1. The storage layer's question names exactly the held keys: the restricted
--    key, the hash copy's, the verified open case's file; never the free file,
--    even though an unverified complaint names it.
SELECT pg_temp.assert_eq('held keys among',
  (SELECT array_to_string(held_storage_keys_among('{00000000-0000-4000-8000-000000000945.png,uploads/copy-of-a.png,uploads/evidence.png,uploads/free.png,nothing/here.png}'), ',')),
  '00000000-0000-4000-8000-000000000945.png,uploads/copy-of-a.png,uploads/evidence.png');
SELECT pg_temp.assert_eq('an empty question answers nothing', (SELECT cardinality(held_storage_keys_among('{}'))::text), '0');
SELECT pg_temp.assert_eq('the service role may ask',
  (SELECT pg_temp.as_role('service_role', 'SELECT cardinality(held_storage_keys_among(''{uploads/evidence.png}''))::text')), '1');

-- 2. Held rows refuse deletion and the loss of their key; a free row does neither.
SELECT pg_temp.expect_error('a restricted file cannot be deleted',
  $q$DELETE FROM assets WHERE id = '00000000-0000-4000-8000-000000000943'$q$, '55000');
SELECT pg_temp.expect_error('a file an open complaint matches cannot be deleted',
  $q$DELETE FROM assets WHERE id = '00000000-0000-4000-8000-000000000944'$q$, '55000');
SELECT pg_temp.expect_error('a held file keeps its key',
  $q$UPDATE assets SET r2_key = NULL, r2_url = NULL WHERE id = '00000000-0000-4000-8000-000000000944'$q$, '55000');
SELECT pg_temp.expect_error('a restricted job cannot be deleted',
  $q$DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000000945'$q$, '55000');
UPDATE assets SET in_library = false WHERE id = '00000000-0000-4000-8000-000000000944';
SELECT pg_temp.assert_eq('a held file may still change other columns',
  (SELECT in_library::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000944'), 'false');
DELETE FROM assets WHERE id = '00000000-0000-4000-8000-000000000946';
SELECT pg_temp.assert_eq('a free file deletes as before', (SELECT count(*)::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000946'), '0');

-- 3. An account under hold answers so; the functions are not the browser's.
--    The other account holds the hash copy (restricted), so it is under hold
--    too; once the restriction is lifted (step 4) it is not.
SELECT pg_temp.assert_eq('the owner is under hold', (SELECT user_has_held_content('00000000-0000-4000-8000-000000000941')::text), 'true');
SELECT pg_temp.assert_eq('the copy''s owner is under hold', (SELECT user_has_held_content('00000000-0000-4000-8000-000000000942')::text), 'true');
SELECT pg_temp.expect_error('an account cannot be deleted while it holds evidence (the cascade meets the hold)',
  $q$DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000941'$q$, '55000');
SELECT pg_temp.expect_error('the hold functions are not callable through PostgREST',
  $q$SELECT pg_temp.as_user('00000000-0000-4000-8000-000000000941', 'SELECT user_has_held_content(''00000000-0000-4000-8000-000000000941'')::text')$q$, '42501');

-- 4. The hold ends with the case and with the lift.
UPDATE rights_complaints SET status = 'closed' WHERE id = '00000000-0000-4000-8000-000000000947';
DELETE FROM assets WHERE id = '00000000-0000-4000-8000-000000000944';
SELECT pg_temp.assert_eq('a closed case releases its file', (SELECT count(*)::text FROM assets WHERE id = '00000000-0000-4000-8000-000000000944'), '0');
SELECT pg_temp.expect_error('the hash copy cannot be deleted while the restriction stands',
  $q$DELETE FROM assets WHERE id = '00000000-0000-4000-8000-000000000949'$q$, '55000');
SELECT lift_content_restriction((SELECT id FROM content_restrictions WHERE lifted_at IS NULL LIMIT 1), NULL, 'lifted');
SELECT pg_temp.assert_eq('a lift releases its keys, the copy''s included',
  (SELECT cardinality(held_storage_keys_among('{00000000-0000-4000-8000-000000000945.png,uploads/copy-of-a.png}'))::text), '0');
DELETE FROM assets WHERE id IN ('00000000-0000-4000-8000-000000000943', '00000000-0000-4000-8000-000000000949');
DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000000945';
SELECT pg_temp.assert_eq('a lifted restriction releases its rows',
  (SELECT count(*)::text FROM assets WHERE id IN ('00000000-0000-4000-8000-000000000943', '00000000-0000-4000-8000-000000000949')) || ',' || (SELECT count(*)::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000000945'), '0,0');
SELECT pg_temp.assert_eq('the account is no longer under hold', (SELECT user_has_held_content('00000000-0000-4000-8000-000000000941')::text), 'false');
SELECT pg_temp.assert_eq('nor is the copy''s owner', (SELECT user_has_held_content('00000000-0000-4000-8000-000000000942')::text), 'false');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
