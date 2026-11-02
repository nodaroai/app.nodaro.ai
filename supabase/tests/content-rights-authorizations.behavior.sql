-- ============================================================================
-- Behavioral proof: content rights, the standing authorization (migration 579).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000991 upward).
--
-- WHY THIS PROOF EXISTS. A standing authorization stands in for a ticked box
-- on every import a key or an agent makes: it is a legal record that must
-- never be edited or deleted, whose ONE change is the revoke, and that must
-- outlive the account. A derived confirmation names it, and a spent
-- confirmation is found by its request so a retry never records a second.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/content-rights-authorizations.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000000991', 'cra-owner@cr.test', '{}', 'authenticated', 'authenticated');

-- 1. An authorization is written by the server under the current declaration;
-- one under an unknown version is refused (checked first: once the account
-- holds an unrevoked row, the one-per-account index refuses before the key).
SELECT pg_temp.expect_error('an unknown declaration version is refused',
  $q$INSERT INTO content_rights_authorizations (user_id, declaration_version, declaration_hash) VALUES ('00000000-0000-4000-8000-000000000991', 999, 'x')$q$, '23503');
INSERT INTO content_rights_authorizations (id, user_id, declaration_version, declaration_hash, ip, user_agent, email)
VALUES ('00000000-0000-4000-8000-000000000992', '00000000-0000-4000-8000-000000000991', 1, (SELECT text_hash FROM rights_declarations WHERE version = 1),
        '203.0.113.7', 'browser/1.0', 'cra-owner@cr.test');
SELECT pg_temp.assert_eq('authorization stored unrevoked', (SELECT (revoked_at IS NULL)::text FROM content_rights_authorizations WHERE id = '00000000-0000-4000-8000-000000000992'), 'true');
-- 1b. One current authorization per account: a second unrevoked row is refused by the index.
SELECT pg_temp.expect_error('a second unrevoked authorization is refused',
  $q$INSERT INTO content_rights_authorizations (user_id, declaration_version, declaration_hash) VALUES ('00000000-0000-4000-8000-000000000991', 1, (SELECT text_hash FROM rights_declarations WHERE version = 1))$q$, '23505');

-- 2. It is a record: no edit, no delete, no truncate.
SELECT pg_temp.expect_error('authorization cannot be edited',
  $q$UPDATE content_rights_authorizations SET declaration_version = 1, declaration_hash = 'other' WHERE id = '00000000-0000-4000-8000-000000000992'$q$, '55000');
SELECT pg_temp.expect_error('authorization cannot be re-owned',
  $q$UPDATE content_rights_authorizations SET user_id = '00000000-0000-4000-8000-000000000971' WHERE id = '00000000-0000-4000-8000-000000000992'$q$, '55000');
SELECT pg_temp.expect_error('authorization cannot be deleted',
  $q$DELETE FROM content_rights_authorizations WHERE id = '00000000-0000-4000-8000-000000000992'$q$, '55000');
-- (A plain TRUNCATE is already refused by the confirmations' foreign key, 0A000;
-- with CASCADE the triggers on this table and the confirmations' refuse it.)
SELECT pg_temp.expect_error('the table cannot be truncated',
  $q$TRUNCATE content_rights_authorizations CASCADE$q$, '55000');

-- 3. A derived confirmation names the authorization it was made from.
INSERT INTO content_rights_confirmations (id, user_id, declaration_version, declaration_hash, source_url, normalized_url, platform, lane, kind, standing_authorization_id)
VALUES ('00000000-0000-4000-8000-000000000993', '00000000-0000-4000-8000-000000000991', 1, (SELECT text_hash FROM rights_declarations WHERE version = 1),
        'https://www.youtube.com/watch?v=abc', 'https://youtube.com/watch?v=abc', 'youtube', 'api', 'derived', '00000000-0000-4000-8000-000000000992');
SELECT pg_temp.assert_eq('derived confirmation names its authorization', (SELECT standing_authorization_id::text FROM content_rights_confirmations WHERE id = '00000000-0000-4000-8000-000000000993'), '00000000-0000-4000-8000-000000000992');
SELECT pg_temp.expect_error('a derived confirmation cannot name an authorization that does not exist',
  $q$INSERT INTO content_rights_confirmations (user_id, declaration_version, declaration_hash, source_url, normalized_url, lane, kind, standing_authorization_id)
     VALUES ('00000000-0000-4000-8000-000000000991', 1, 'h', 'https://youtu.be/x', 'https://youtu.be/x', 'api', 'derived', '00000000-0000-4000-8000-000000000999')$q$, '23503');

-- 4. The spend is found by its request: the index the retry lookup reads exists and is partial.
INSERT INTO rights_events (confirmation_id, kind, lane, request_id) VALUES ('00000000-0000-4000-8000-000000000993', 'confirmed', 'api', 'job-1');
INSERT INTO rights_events (confirmation_id, kind, lane, request_id) VALUES ('00000000-0000-4000-8000-000000000993', 'consumed', 'api', 'job-1');
SELECT pg_temp.assert_eq('the spend is found by its request', (SELECT confirmation_id::text FROM rights_events WHERE request_id = 'job-1' AND kind = 'consumed'), '00000000-0000-4000-8000-000000000993');
SELECT pg_temp.assert_eq('request index is partial on consumed events', (SELECT (indexdef LIKE '%WHERE%consumed%')::text FROM pg_indexes WHERE indexname = 'rights_events_request_idx'), 'true');

-- 5. The ONE change: a revoke, once. A revoked row cannot be un-revoked or re-revoked to another time.
UPDATE content_rights_authorizations SET revoked_at = now() WHERE id = '00000000-0000-4000-8000-000000000992';
SELECT pg_temp.assert_eq('revoked', (SELECT (revoked_at IS NOT NULL)::text FROM content_rights_authorizations WHERE id = '00000000-0000-4000-8000-000000000992'), 'true');
SELECT pg_temp.expect_error('a revoke cannot be undone',
  $q$UPDATE content_rights_authorizations SET revoked_at = NULL WHERE id = '00000000-0000-4000-8000-000000000992'$q$, '55000');
SELECT pg_temp.expect_error('a revoke cannot be moved',
  $q$UPDATE content_rights_authorizations SET revoked_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-000000000992'$q$, '55000');
SELECT pg_temp.assert_eq('the revoked row is out of the current index', (SELECT (indexdef LIKE '%WHERE%revoked_at IS NULL%')::text FROM pg_indexes WHERE indexname = 'content_rights_authorizations_user_idx'), 'true');

-- 6. A scrub is allowed: the personal data may go to null, nothing else may change.
INSERT INTO content_rights_authorizations (id, user_id, declaration_version, declaration_hash, ip, user_agent, email)
VALUES ('00000000-0000-4000-8000-000000000994', '00000000-0000-4000-8000-000000000991', 1, (SELECT text_hash FROM rights_declarations WHERE version = 1), '203.0.113.7', 'ua', 'cra-owner@cr.test');
UPDATE content_rights_authorizations SET ip = NULL, email = NULL, user_agent = NULL WHERE id = '00000000-0000-4000-8000-000000000994';
SELECT pg_temp.assert_eq('scrub nulls the personal data', (SELECT (ip IS NULL AND email IS NULL AND user_agent IS NULL)::text FROM content_rights_authorizations WHERE id = '00000000-0000-4000-8000-000000000994'), 'true');
SELECT pg_temp.expect_error('a scrub cannot put another value in',
  $q$UPDATE content_rights_authorizations SET email = 'other@cr.test' WHERE id = '00000000-0000-4000-8000-000000000994'$q$, '55000');

-- 7. The record outlives the account: deleting the user nulls the owner and keeps the rows.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000991';
SELECT pg_temp.assert_eq('authorizations survive the account', (SELECT count(*)::text FROM content_rights_authorizations WHERE id IN ('00000000-0000-4000-8000-000000000992', '00000000-0000-4000-8000-000000000994')), '2');
SELECT pg_temp.assert_eq('owner is null after deletion', (SELECT (user_id IS NULL)::text FROM content_rights_authorizations WHERE id = '00000000-0000-4000-8000-000000000992'), 'true');
SELECT pg_temp.assert_eq('the derived confirmation survives too', (SELECT count(*)::text FROM content_rights_confirmations WHERE id = '00000000-0000-4000-8000-000000000993'), '1');

-- 8. Nobody but the server reads or writes the table.
SELECT pg_temp.assert_eq('authorizations revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'content_rights_authorizations' AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('rls on', (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'content_rights_authorizations'), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
