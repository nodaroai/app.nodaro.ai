-- ============================================================================
-- Behavioral proof: content complaints (migration 580).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000981 upward).
--
-- WHY THIS PROOF EXISTS. A complaint case is a legal record: the server moves
-- it (status, handler, decision, the matches, the verification), but what the
-- complainant submitted never changes, the case is never deleted, its events
-- are never edited or deleted, and neither table is truncated. The reference
-- number is made here and is unique. Nothing is readable through PostgREST.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/rights-complaints.behavior.sql mig-test:/tmp/t.sql
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000981', 'rc-user@cr.test', '{}', 'authenticated', 'authenticated');

-- 1. A submission opens a case with a server-made reference, unverified.
INSERT INTO rights_complaints (id, kind, category, complainant_name_enc, complainant_email_enc, complainant_email_hash,
  claimant_role, original_work, reported_content, explanation, statements_hash, verification_token_hash, verification_expires_at)
VALUES ('00000000-0000-4000-8000-000000000982', 'copyright', 'copyright_infringement', 'enc-name', 'enc-email', 'hash-1',
  'owner', 'a film', 'https://cdn.example.test/v.mp4', 'used without permission', 'st-hash', 'tok-hash', now() + interval '3 days');
SELECT pg_temp.assert_eq('reference is made by the server',
  (SELECT (reference ~ '^CR-\d{4}-\d{6}$')::text FROM rights_complaints WHERE id = '00000000-0000-4000-8000-000000000982'), 'true');
SELECT pg_temp.assert_eq('case opens received and unverified',
  (SELECT status || ',' || (verified_at IS NULL)::text FROM rights_complaints WHERE id = '00000000-0000-4000-8000-000000000982'), 'received,true');
INSERT INTO rights_complaints (id, kind, category, complainant_name_enc, complainant_email_enc, complainant_email_hash, reported_content, explanation)
VALUES ('00000000-0000-4000-8000-000000000983', 'other', 'privacy', 'enc-name', 'enc-email', 'hash-2', 'somewhere', 'what happened');
SELECT pg_temp.assert_eq('two cases, two references',
  (SELECT count(DISTINCT reference)::text FROM rights_complaints WHERE id IN ('00000000-0000-4000-8000-000000000982', '00000000-0000-4000-8000-000000000983')), '2');
SELECT pg_temp.expect_error('an unknown status is refused',
  $q$UPDATE rights_complaints SET status = 'lost' WHERE id = '00000000-0000-4000-8000-000000000982'$q$, '23514');
SELECT pg_temp.expect_error('an unknown category is refused',
  $q$INSERT INTO rights_complaints (kind, category, complainant_name_enc, complainant_email_enc, complainant_email_hash, reported_content, explanation) VALUES ('other', 'spam', 'n', 'e', 'h', 'r', 'x')$q$, '23514');

-- 2. The server moves the case; the submission never changes; the case is never deleted.
UPDATE rights_complaints SET verified_at = now(), verification_token_hash = NULL WHERE id = '00000000-0000-4000-8000-000000000982';
UPDATE rights_complaints SET status = 'under_review', handler_user_id = '00000000-0000-4000-8000-000000000981',
  user_id = '00000000-0000-4000-8000-000000000981', matched_asset_ids = '{}', decision = NULL
  WHERE id = '00000000-0000-4000-8000-000000000982';
SELECT pg_temp.assert_eq('the case moved',
  (SELECT status || ',' || (verified_at IS NOT NULL)::text FROM rights_complaints WHERE id = '00000000-0000-4000-8000-000000000982'), 'under_review,true');
-- The database logged both changes itself, naming the columns and no value.
SELECT pg_temp.assert_eq('every change is logged by the database',
  (SELECT string_agg(data->>'columns', ';' ORDER BY data->>'columns') FROM rights_complaint_events WHERE complaint_id = '00000000-0000-4000-8000-000000000982' AND kind = 'row_updated' AND actor = 'database'),
  '["handler_user_id", "status", "user_id"];["verification_token_hash", "verified_at"]');
SELECT pg_temp.expect_error('the complainant''s details cannot be edited',
  $q$UPDATE rights_complaints SET complainant_email_enc = 'other' WHERE id = '00000000-0000-4000-8000-000000000982'$q$, '55000');
SELECT pg_temp.expect_error('the submitted explanation cannot be edited',
  $q$UPDATE rights_complaints SET explanation = 'changed' WHERE id = '00000000-0000-4000-8000-000000000982'$q$, '55000');
SELECT pg_temp.expect_error('the affirmed statements cannot be edited',
  $q$UPDATE rights_complaints SET statements_hash = 'x' WHERE id = '00000000-0000-4000-8000-000000000982'$q$, '55000');
SELECT pg_temp.expect_error('the reference cannot be edited',
  $q$UPDATE rights_complaints SET reference = 'CR-2000-000001' WHERE id = '00000000-0000-4000-8000-000000000982'$q$, '55000');
SELECT pg_temp.expect_error('a case cannot be deleted',
  $q$DELETE FROM rights_complaints WHERE id = '00000000-0000-4000-8000-000000000983'$q$, '55000');

-- 3. Events are appended, never edited or deleted.
INSERT INTO rights_complaint_events (id, complaint_id, kind, actor, data)
VALUES ('00000000-0000-4000-8000-000000000984', '00000000-0000-4000-8000-000000000982', 'received', 'complainant', '{"links": 1}');
SELECT pg_temp.expect_error('an event cannot be edited',
  $q$UPDATE rights_complaint_events SET kind = 'other' WHERE id = '00000000-0000-4000-8000-000000000984'$q$, '55000');
SELECT pg_temp.expect_error('an event cannot be deleted',
  $q$DELETE FROM rights_complaint_events WHERE id = '00000000-0000-4000-8000-000000000984'$q$, '55000');
SELECT pg_temp.expect_error('an event needs its case',
  $q$INSERT INTO rights_complaint_events (complaint_id, kind, actor) VALUES ('00000000-0000-4000-8000-000000000999', 'note', 'system')$q$, '23503');

-- 4. Neither table is truncated (CASCADE: the events' foreign key refuses a plain one first).
SELECT pg_temp.expect_error('the cases cannot be truncated',
  $q$TRUNCATE rights_complaints CASCADE$q$, '55000');
SELECT pg_temp.expect_error('the events cannot be truncated',
  $q$TRUNCATE rights_complaint_events$q$, '55000');

-- 5. A deleted account leaves the case; the record stays.
UPDATE rights_complaints SET user_id = '00000000-0000-4000-8000-000000000981' WHERE id = '00000000-0000-4000-8000-000000000983';
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000981';
SELECT pg_temp.assert_eq('the case outlives the account it named',
  (SELECT (user_id IS NULL)::text || ',' || (handler_user_id IS NULL)::text FROM rights_complaints WHERE id = '00000000-0000-4000-8000-000000000982'), 'true,true');
SELECT pg_temp.assert_eq('the account''s removal is logged too',
  (SELECT count(*)::text FROM rights_complaint_events WHERE complaint_id = '00000000-0000-4000-8000-000000000982' AND kind = 'row_updated' AND data->'columns' ? 'user_id'), '2');
SELECT pg_temp.assert_eq('both cases still there', (SELECT count(*)::text FROM rights_complaints WHERE id IN ('00000000-0000-4000-8000-000000000982', '00000000-0000-4000-8000-000000000983')), '2');

-- 6. Nothing through PostgREST.
SELECT pg_temp.assert_eq('cases revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'rights_complaints' AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('events revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'rights_complaint_events' AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('rls on', (SELECT string_agg(relname || '=' || relrowsecurity::text, ',' ORDER BY relname) FROM pg_class WHERE relname IN ('rights_complaints', 'rights_complaint_events')),
  'rights_complaint_events=true,rights_complaints=true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
