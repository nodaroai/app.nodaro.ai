-- ============================================================================
-- Behavioral proof: repeat infringers (migration 588).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000587001 upward).
--
-- WHY THIS PROOF EXISTS. The record of an account's infringements, and of the
-- measures taken on it, is what shows the repeat-infringer policy was applied
-- reasonably and consistently. So: an infringement is recorded only from a
-- case whose complainant proved their email, against the account that case
-- names, once per case while it stands; a measure from a case is taken on
-- the account that verified case names, follows only a standing infringement
-- of that same account, and an import block or a closure is not taken twice
-- while one is in force. Nothing recorded or applied ever changes; the
-- withdrawal and the lift are each taken once, whole, stamped by the
-- database; a lift only while the measure is in force; a warning is never
-- lifted. Nothing is deleted or truncated. A person named on a record is
-- never replaced, and only the removal of their account clears the name.
-- Nothing is readable through PostgREST.
--
-- Not proven here: two administrators taking the same measure at the same
-- instant (the advisory lock serializes them; one session cannot race).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/repeat-infringers.behavior.sql mig-test:/tmp/t.sql
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

-- Runs a statement that must fail, and checks the SQLSTATE it failed with.
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

-- An infringement from a case, against an account, by an administrator.
CREATE FUNCTION pg_temp.record(infringement_id uuid, case_id uuid, account uuid, admin uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO account_infringements (id, complaint_id, user_id, recorded_by, note)
  VALUES (infringement_id, case_id, account, admin, 'the uploaded film is the complainant''s');
$$;

-- A measure on an account that follows the policy's step.
CREATE FUNCTION pg_temp.apply(measure_id uuid, account uuid, measure text, ends timestamptz, case_id uuid, infringement uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO account_sanctions (id, user_id, kind, ends_at, reason, complaint_id, infringement_id, infringements_in_window, policy_step, applied_by)
  VALUES (measure_id, account, measure, ends, 'Repeated copyright complaints', case_id, infringement, 1,
    jsonb_build_object('infringements', 1, 'kind', measure), '00000000-0000-4000-8000-000000587002');
$$;

-- The account, two administrators, and someone else.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000587001', 'ri-owner@ri.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000587002', 'ri-admin@ri.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000587003', 'ri-admin2@ri.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000587004', 'ri-other@ri.test', '{}', 'authenticated', 'authenticated');

-- Two verified cases naming the account, an unverified one, a verified one naming someone else, and a verified complaint of another kind.
INSERT INTO rights_complaints (id, kind, category, status, complainant_name_enc, complainant_email_enc, complainant_email_hash, reported_content, explanation, verified_at, user_id) VALUES
  ('00000000-0000-4000-8000-000000587011', 'copyright', 'copyright_infringement', 'content_restricted', 'enc-name', 'enc-email', 'hash-ri', 'https://cdn.example.test/a.mp4', 'mine', now(), '00000000-0000-4000-8000-000000587001'),
  ('00000000-0000-4000-8000-000000587012', 'copyright', 'copyright_infringement', 'resolved', 'enc-name', 'enc-email', 'hash-ri', 'https://cdn.example.test/b.mp4', 'mine', now(), '00000000-0000-4000-8000-000000587001'),
  ('00000000-0000-4000-8000-000000587013', 'copyright', 'copyright_infringement', 'received', 'enc-name', 'enc-email', 'hash-ri', 'https://cdn.example.test/c.mp4', 'mine', NULL, '00000000-0000-4000-8000-000000587001'),
  ('00000000-0000-4000-8000-000000587014', 'copyright', 'copyright_infringement', 'content_restricted', 'enc-name', 'enc-email', 'hash-ri', 'https://cdn.example.test/d.mp4', 'mine', now(), '00000000-0000-4000-8000-000000587004'),
  ('00000000-0000-4000-8000-000000587015', 'other', 'privacy', 'content_restricted', 'enc-name', 'enc-email', 'hash-ri', 'https://cdn.example.test/e.mp4', 'me', now(), '00000000-0000-4000-8000-000000587001'),
  ('00000000-0000-4000-8000-000000587016', 'copyright', 'copyright_infringement', 'resolved', 'enc-name', 'enc-email', 'hash-ri', 'https://cdn.example.test/f.mp4', 'mine', now(), '00000000-0000-4000-8000-000000587001');

-- 1. An infringement: from a verified case, against the account it names, stamped by the database.
SELECT pg_temp.record('00000000-0000-4000-8000-000000587021', '00000000-0000-4000-8000-000000587011', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002');
SELECT pg_temp.assert_eq('recorded with the clock, standing',
  (SELECT (recorded_at IS NOT NULL AND withdrawn_at IS NULL)::text FROM account_infringements WHERE id = '00000000-0000-4000-8000-000000587021'), 'true');
SELECT pg_temp.expect_error('one standing infringement per case and account',
  $q$SELECT pg_temp.record(gen_random_uuid(), '00000000-0000-4000-8000-000000587011', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587003')$q$, '23505');
SELECT pg_temp.expect_error('not from a case whose complainant did not prove their email',
  $q$SELECT pg_temp.record(gen_random_uuid(), '00000000-0000-4000-8000-000000587013', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002')$q$, '55028');
SELECT pg_temp.expect_error('not against an account the case does not name',
  $q$SELECT pg_temp.record(gen_random_uuid(), '00000000-0000-4000-8000-000000587014', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002')$q$, '55028');
SELECT pg_temp.expect_error('not against no account',
  $q$SELECT pg_temp.record(gen_random_uuid(), '00000000-0000-4000-8000-000000587011', NULL, '00000000-0000-4000-8000-000000587002')$q$, '55028');
SELECT pg_temp.expect_error('not without the administrator who recorded it',
  $q$SELECT pg_temp.record(gen_random_uuid(), '00000000-0000-4000-8000-000000587012', '00000000-0000-4000-8000-000000587001', NULL)$q$, '55000');
SELECT pg_temp.expect_error('not from a case that does not exist',
  $q$SELECT pg_temp.record(gen_random_uuid(), '00000000-0000-4000-8000-0000005870ff', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002')$q$, '23503');
SELECT pg_temp.expect_error('recorded standing, never already withdrawn',
  $q$INSERT INTO account_infringements (complaint_id, user_id, recorded_by, withdrawn_at, withdrawn_by, withdraw_reason) VALUES ('00000000-0000-4000-8000-000000587012', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002', now(), '00000000-0000-4000-8000-000000587002', 'x')$q$, '55000');
SELECT pg_temp.record('00000000-0000-4000-8000-000000587022', '00000000-0000-4000-8000-000000587012', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002');
SELECT pg_temp.record('00000000-0000-4000-8000-000000587023', '00000000-0000-4000-8000-000000587015', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002');
SELECT pg_temp.assert_eq('a second case, and a complaint of another kind, each record one',
  (SELECT count(*)::text FROM account_infringements WHERE user_id = '00000000-0000-4000-8000-000000587001'), '3');

-- 2. Nothing recorded changes; never deleted, never truncated.
SELECT pg_temp.expect_error('the note cannot be edited',
  $q$UPDATE account_infringements SET note = 'changed' WHERE id = '00000000-0000-4000-8000-000000587021'$q$, '55000');
SELECT pg_temp.expect_error('the case cannot be changed',
  $q$UPDATE account_infringements SET complaint_id = '00000000-0000-4000-8000-000000587012' WHERE id = '00000000-0000-4000-8000-000000587021'$q$, '55000');
SELECT pg_temp.expect_error('the time cannot be redated',
  $q$UPDATE account_infringements SET recorded_at = now() - interval '3 years' WHERE id = '00000000-0000-4000-8000-000000587021'$q$, '55000');
SELECT pg_temp.expect_error('the account is never replaced',
  $q$UPDATE account_infringements SET user_id = '00000000-0000-4000-8000-000000587004' WHERE id = '00000000-0000-4000-8000-000000587021'$q$, '55000');
SELECT pg_temp.expect_error('the account is not cleared while it exists',
  $q$UPDATE account_infringements SET user_id = NULL WHERE id = '00000000-0000-4000-8000-000000587021'$q$, '55000');
SELECT pg_temp.expect_error('the administrator is never replaced',
  $q$UPDATE account_infringements SET recorded_by = '00000000-0000-4000-8000-000000587003' WHERE id = '00000000-0000-4000-8000-000000587021'$q$, '55000');
SELECT pg_temp.expect_error('an infringement is never deleted',
  $q$DELETE FROM account_infringements WHERE id = '00000000-0000-4000-8000-000000587021'$q$, '55000');
-- (A plain TRUNCATE is refused by the measures' foreign key first, 0A000; CASCADE reaches both triggers.)
SELECT pg_temp.expect_error('infringements are never truncated',
  $q$TRUNCATE account_infringements CASCADE$q$, '55000');

-- 3. The withdrawal: whole, once, stamped by the database.
SELECT pg_temp.expect_error('a withdrawal is not written in parts (reason alone)',
  $q$UPDATE account_infringements SET withdraw_reason = 'appeal upheld' WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
SELECT pg_temp.expect_error('a withdrawal names its administrator',
  $q$UPDATE account_infringements SET withdrawn_at = now(), withdraw_reason = 'appeal upheld' WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
SELECT pg_temp.expect_error('a withdrawal says why',
  $q$UPDATE account_infringements SET withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-000000587002' WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
UPDATE account_infringements SET withdrawn_at = now() - interval '9 years', withdrawn_by = '00000000-0000-4000-8000-000000587003', withdraw_reason = 'content restored after a counter-notice'
 WHERE id = '00000000-0000-4000-8000-000000587022';
SELECT pg_temp.assert_eq('the withdrawal is stamped by the clock, after the recording',
  (SELECT (withdrawn_at >= recorded_at AND withdrawn_at > now() - interval '1 day')::text FROM account_infringements WHERE id = '00000000-0000-4000-8000-000000587022'), 'true');
SELECT pg_temp.expect_error('withdrawn once: not redated',
  $q$UPDATE account_infringements SET withdrawn_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
SELECT pg_temp.expect_error('withdrawn once: the reason stays',
  $q$UPDATE account_infringements SET withdraw_reason = 'another' WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
SELECT pg_temp.expect_error('withdrawn once: never taken back',
  $q$UPDATE account_infringements SET withdrawn_at = NULL, withdrawn_by = NULL, withdraw_reason = NULL WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
SELECT pg_temp.expect_error('withdrawn once: the administrator is never replaced',
  $q$UPDATE account_infringements SET withdrawn_by = '00000000-0000-4000-8000-000000587002' WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
SELECT pg_temp.record('00000000-0000-4000-8000-000000587024', '00000000-0000-4000-8000-000000587012', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002');
SELECT pg_temp.assert_eq('a withdrawn infringement leaves the case free for a new one',
  (SELECT count(*)::text FROM account_infringements WHERE complaint_id = '00000000-0000-4000-8000-000000587012'), '2');

-- 4. A measure: on the account a verified case names, following a standing infringement of it.
SELECT pg_temp.apply('00000000-0000-4000-8000-000000587031', '00000000-0000-4000-8000-000000587001', 'warning', NULL,
  '00000000-0000-4000-8000-000000587011', '00000000-0000-4000-8000-000000587021');
SELECT pg_temp.assert_eq('applied with the clock, in force',
  (SELECT (applied_at IS NOT NULL AND lifted_at IS NULL)::text FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000587031'), 'true');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000587032', '00000000-0000-4000-8000-000000587001', 'warning', NULL, '00000000-0000-4000-8000-000000587011', NULL);
SELECT pg_temp.assert_eq('warnings are events: another one stands beside the first',
  (SELECT count(*)::text FROM account_sanctions WHERE kind = 'warning' AND user_id = '00000000-0000-4000-8000-000000587001'), '2');
SELECT pg_temp.expect_error('not from a case whose complainant did not prove their email',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'warning', NULL, '00000000-0000-4000-8000-000000587013', NULL)$q$, '55028');
SELECT pg_temp.expect_error('not from a case naming another account',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'warning', NULL, '00000000-0000-4000-8000-000000587014', NULL)$q$, '55028');
SELECT pg_temp.expect_error('not following another account''s infringement',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587004', 'warning', NULL, NULL, '00000000-0000-4000-8000-000000587021')$q$, '55028');
SELECT pg_temp.expect_error('not following a withdrawn infringement',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'warning', NULL, NULL, '00000000-0000-4000-8000-000000587022')$q$, '55028');
SELECT pg_temp.expect_error('not on no account',
  $q$SELECT pg_temp.apply(gen_random_uuid(), NULL, 'warning', NULL, NULL, NULL)$q$, '55000');
SELECT pg_temp.expect_error('not without its administrator',
  $q$INSERT INTO account_sanctions (user_id, kind, reason, infringements_in_window, departure_reason) VALUES ('00000000-0000-4000-8000-000000587001', 'warning', 'r', 0, 'first contact')$q$, '55000');
SELECT pg_temp.expect_error('taken in force, never already lifted',
  $q$INSERT INTO account_sanctions (user_id, kind, reason, infringements_in_window, departure_reason, applied_by, lifted_at, lifted_by, lift_reason) VALUES ('00000000-0000-4000-8000-000000587001', 'imports_blocked', 'r', 0, 'd', '00000000-0000-4000-8000-000000587002', now(), '00000000-0000-4000-8000-000000587002', 'x')$q$, '55000');
SELECT pg_temp.expect_error('it follows the policy or says why not (neither)',
  $q$INSERT INTO account_sanctions (user_id, kind, reason, infringements_in_window, applied_by) VALUES ('00000000-0000-4000-8000-000000587001', 'warning', 'r', 0, '00000000-0000-4000-8000-000000587002')$q$, '23514');
SELECT pg_temp.expect_error('it follows the policy or says why not (both)',
  $q$INSERT INTO account_sanctions (user_id, kind, reason, infringements_in_window, policy_step, departure_reason, applied_by) VALUES ('00000000-0000-4000-8000-000000587001', 'warning', 'r', 0, '{"infringements": 1}', 'd', '00000000-0000-4000-8000-000000587002')$q$, '23514');
SELECT pg_temp.expect_error('a kind the record does not know',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'fined', NULL, NULL, NULL)$q$, '23514');
SELECT pg_temp.expect_error('a warning has no end',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'warning', now() + interval '30 days', NULL, NULL)$q$, '23514');
SELECT pg_temp.expect_error('a closure has no end of its own',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'closed', now() + interval '30 days', NULL, NULL)$q$, '23514');
SELECT pg_temp.expect_error('a measure ends after it is applied',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'imports_blocked', now() - interval '1 day', NULL, NULL)$q$, '23514');

-- 5. An import block, or a closure, is not taken twice while one is in force.
SELECT pg_temp.apply('00000000-0000-4000-8000-000000587033', '00000000-0000-4000-8000-000000587001', 'imports_blocked', now() + interval '30 days', '00000000-0000-4000-8000-000000587011', NULL);
SELECT pg_temp.expect_error('a second import block while one is in force',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'imports_blocked', NULL, NULL, NULL)$q$, '55029');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000587034', '00000000-0000-4000-8000-000000587001', 'closed', NULL, '00000000-0000-4000-8000-000000587012', '00000000-0000-4000-8000-000000587024');
SELECT pg_temp.expect_error('a second closure while one is in force',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587001', 'closed', NULL, NULL, NULL)$q$, '55029');
SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000587004', 'imports_blocked', NULL, '00000000-0000-4000-8000-000000587014', NULL);
SELECT pg_temp.assert_eq('another account''s import block is its own',
  (SELECT count(*)::text FROM account_sanctions WHERE kind = 'imports_blocked' AND lifted_at IS NULL), '2');

-- 6. Nothing applied changes; never deleted, never truncated.
SELECT pg_temp.expect_error('the kind cannot be changed',
  $q$UPDATE account_sanctions SET kind = 'warning' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('the end cannot be moved',
  $q$UPDATE account_sanctions SET ends_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('what the owner was told cannot be edited',
  $q$UPDATE account_sanctions SET reason = 'changed' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('the policy step cannot be rewritten',
  $q$UPDATE account_sanctions SET policy_step = '{"infringements": 9}' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('the count cannot be rewritten',
  $q$UPDATE account_sanctions SET infringements_in_window = 5 WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('the time cannot be redated',
  $q$UPDATE account_sanctions SET applied_at = now() - interval '3 years' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('the administrator is never replaced',
  $q$UPDATE account_sanctions SET applied_by = '00000000-0000-4000-8000-000000587003' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('a measure is never deleted',
  $q$DELETE FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('measures are never truncated',
  $q$TRUNCATE account_sanctions$q$, '55000');

-- 7. The lift: whole, once, stamped by the database, while the measure is in force; a warning stands.
SELECT pg_temp.expect_error('a lift is not written in parts',
  $q$UPDATE account_sanctions SET lift_reason = 'appeal upheld' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('a lift names its administrator',
  $q$UPDATE account_sanctions SET lifted_at = now(), lift_reason = 'appeal upheld' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('a warning is never lifted',
  $q$UPDATE account_sanctions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000587002', lift_reason = 'x' WHERE id = '00000000-0000-4000-8000-000000587031'$q$, '23514');
UPDATE account_sanctions SET lifted_at = now() - interval '9 years', lifted_by = '00000000-0000-4000-8000-000000587003', lift_reason = 'appeal upheld'
 WHERE id = '00000000-0000-4000-8000-000000587033';
SELECT pg_temp.assert_eq('the lift is stamped by the clock',
  (SELECT (lifted_at >= applied_at AND lifted_at > now() - interval '1 day')::text FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000587033'), 'true');
SELECT pg_temp.expect_error('lifted once: not redated',
  $q$UPDATE account_sanctions SET lifted_at = now() + interval '1 hour' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.expect_error('lifted once: never taken back',
  $q$UPDATE account_sanctions SET lifted_at = NULL, lifted_by = NULL, lift_reason = NULL WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000587035', '00000000-0000-4000-8000-000000587001', 'imports_blocked',
  clock_timestamp() + interval '300 milliseconds', NULL, NULL);
SELECT pg_temp.assert_eq('a lifted import block leaves room for a new one',
  (SELECT (lifted_at IS NULL)::text FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000587035'), 'true');
SELECT pg_sleep(0.5);
SELECT pg_temp.expect_error('a measure that ended is not lifted after the fact',
  $q$UPDATE account_sanctions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000587002', lift_reason = 'late' WHERE id = '00000000-0000-4000-8000-000000587035'$q$, '23514');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000587036', '00000000-0000-4000-8000-000000587001', 'imports_blocked', NULL, NULL, NULL);
SELECT pg_temp.assert_eq('an import block that ended leaves room for a new one',
  (SELECT count(*)::text FROM account_sanctions WHERE user_id = '00000000-0000-4000-8000-000000587001' AND kind = 'imports_blocked'), '3');

-- 7b. The server's own role withdraws and lifts: the triggers call their helper as it.
SELECT pg_temp.record('00000000-0000-4000-8000-000000587025', '00000000-0000-4000-8000-000000587016', '00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587002');
SET LOCAL ROLE service_role;
UPDATE account_infringements SET withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-000000587002', withdraw_reason = 'appeal upheld'
 WHERE id = '00000000-0000-4000-8000-000000587025';
UPDATE account_sanctions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000587002', lift_reason = 'lifted by the server'
 WHERE id = '00000000-0000-4000-8000-000000587036';
RESET ROLE;
SELECT pg_temp.assert_eq('the server''s role withdrew and lifted',
  (SELECT (i.withdrawn_at IS NOT NULL AND s.lifted_at IS NOT NULL)::text FROM account_infringements i, account_sanctions s
    WHERE i.id = '00000000-0000-4000-8000-000000587025' AND s.id = '00000000-0000-4000-8000-000000587036'), 'true');

-- 8. The record outlives the accounts it names; a cleared name is never filled in.
DELETE FROM auth.users WHERE id IN ('00000000-0000-4000-8000-000000587001', '00000000-0000-4000-8000-000000587003');
SELECT pg_temp.assert_eq('the infringement outlives the account and the administrator who withdrew it',
  (SELECT (user_id IS NULL)::text || ',' || (recorded_by IS NOT NULL)::text || ',' || (withdrawn_by IS NULL)::text || ',' || withdraw_reason
   FROM account_infringements WHERE id = '00000000-0000-4000-8000-000000587022'), 'true,true,true,content restored after a counter-notice');
SELECT pg_temp.assert_eq('the measure outlives the account and the administrator who lifted it',
  (SELECT (user_id IS NULL)::text || ',' || (lifted_by IS NULL)::text || ',' || kind || ',' || lift_reason
   FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000587033'), 'true,true,imports_blocked,appeal upheld');
SELECT pg_temp.expect_error('a cleared account is never filled in with someone else',
  $q$UPDATE account_infringements SET user_id = '00000000-0000-4000-8000-000000587004' WHERE id = '00000000-0000-4000-8000-000000587022'$q$, '55000');
SELECT pg_temp.expect_error('a cleared administrator is never filled in with someone else',
  $q$UPDATE account_sanctions SET lifted_by = '00000000-0000-4000-8000-000000587002' WHERE id = '00000000-0000-4000-8000-000000587033'$q$, '55000');

-- 9. Nothing through PostgREST.
SELECT pg_temp.assert_eq('revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('account_infringements', 'account_sanctions') AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('rls on both',
  (SELECT string_agg(relrowsecurity::text, ',' ORDER BY relname) FROM pg_class WHERE relname IN ('account_infringements', 'account_sanctions') AND relkind = 'r'), 'true,true');
SELECT pg_temp.assert_eq('the helper is not callable through PostgREST',
  (SELECT (has_function_privilege('anon', 'public.rights_record_person_kept(uuid, uuid)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.rights_record_person_kept(uuid, uuid)', 'EXECUTE'))::text), 'false');
SELECT pg_temp.assert_eq('the server''s role may call the helper, by name',
  (SELECT has_function_privilege('service_role', 'public.rights_record_person_kept(uuid, uuid)', 'EXECUTE')::text), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
