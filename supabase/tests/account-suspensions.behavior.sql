-- ============================================================================
-- Behavioral proof: suspensions (migration 589, on 588's measures).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000589001 upward).
--
-- WHY THIS PROOF EXISTS. A suspension refuses an account everything until it
-- ends, so the record must say exactly when that is: a suspension always has
-- an end after it is taken, one is in force on an account at a time, its end
-- never moves, and it is lifted early only while it is in force, once, whole.
-- The server reads the suspensions not lifted through their own index.
--
-- Run locally: as repeat-infringers.behavior.sql says, with this file.
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

-- A measure on the account, from its verified case, departing from the policy (the proof is about the measure).
CREATE FUNCTION pg_temp.apply(measure_id uuid, account uuid, measure text, ends timestamptz) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO account_sanctions (id, user_id, kind, ends_at, reason, complaint_id, infringements_in_window, departure_reason, applied_by)
  VALUES (measure_id, account, measure, ends, 'Repeated copyright complaints', '00000000-0000-4000-8000-000000589011', 2,
    'the proof takes it', '00000000-0000-4000-8000-000000589002');
$$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000589001', 'su-owner@su.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000589002', 'su-admin@su.test', '{}', 'authenticated', 'authenticated');

INSERT INTO rights_complaints (id, kind, category, status, complainant_name_enc, complainant_email_enc, complainant_email_hash, reported_content, explanation, verified_at, user_id) VALUES
  ('00000000-0000-4000-8000-000000589011', 'copyright', 'copyright_infringement', 'content_restricted', 'enc-name', 'enc-email', 'hash-su', 'https://cdn.example.test/a.mp4', 'mine', now(), '00000000-0000-4000-8000-000000589001');

-- 1. A suspension always has an end, after it is taken.
SELECT pg_temp.expect_error('a suspension without an end',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000589001', 'suspended', NULL)$q$, '23514');
SELECT pg_temp.expect_error('a suspension that ends before it is taken',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000589001', 'suspended', now() - interval '1 day')$q$, '23514');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000589031', '00000000-0000-4000-8000-000000589001', 'suspended', now() + interval '7 days');
SELECT pg_temp.assert_eq('a suspension with an end is taken, in force',
  (SELECT (lifted_at IS NULL AND ends_at > applied_at)::text FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000589031'), 'true');

-- 2. One in force at a time; beside a measure of another kind.
SELECT pg_temp.expect_error('a second suspension while one is in force',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000589001', 'suspended', now() + interval '30 days')$q$, '55029');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000589032', '00000000-0000-4000-8000-000000589001', 'imports_blocked', now() + interval '30 days');
SELECT pg_temp.assert_eq('an import block stands beside the suspension',
  (SELECT count(*)::text FROM account_sanctions WHERE user_id = '00000000-0000-4000-8000-000000589001' AND lifted_at IS NULL), '2');

-- 3. Its end never moves; it is never deleted.
SELECT pg_temp.expect_error('the end cannot be moved',
  $q$UPDATE account_sanctions SET ends_at = now() + interval '1 year' WHERE id = '00000000-0000-4000-8000-000000589031'$q$, '55000');
SELECT pg_temp.expect_error('the kind cannot be changed',
  $q$UPDATE account_sanctions SET kind = 'closed' WHERE id = '00000000-0000-4000-8000-000000589031'$q$, '55000');
SELECT pg_temp.expect_error('a suspension is never deleted',
  $q$DELETE FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000589031'$q$, '55000');

-- 4. Lifted early: whole, once, while in force; then a new one may be taken.
SELECT pg_temp.expect_error('a lift says why',
  $q$UPDATE account_sanctions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000589002' WHERE id = '00000000-0000-4000-8000-000000589031'$q$, '55000');
UPDATE account_sanctions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000589002', lift_reason = 'appeal upheld'
 WHERE id = '00000000-0000-4000-8000-000000589031';
SELECT pg_temp.assert_eq('lifted before its end',
  (SELECT (lifted_at < ends_at)::text FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000589031'), 'true');
SELECT pg_temp.expect_error('lifted once',
  $q$UPDATE account_sanctions SET lifted_at = NULL, lifted_by = NULL, lift_reason = NULL WHERE id = '00000000-0000-4000-8000-000000589031'$q$, '55000');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000589033', '00000000-0000-4000-8000-000000589001', 'suspended',
  clock_timestamp() + interval '2 seconds');
SELECT pg_temp.assert_eq('a lifted suspension leaves room for a new one',
  (SELECT (lifted_at IS NULL)::text FROM account_sanctions WHERE id = '00000000-0000-4000-8000-000000589033'), 'true');

-- 5. One that ended is not lifted after the fact, and leaves room for a new one.
SELECT pg_sleep(2.5);
SELECT pg_temp.expect_error('a suspension that ended is not lifted after the fact',
  $q$UPDATE account_sanctions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000589002', lift_reason = 'late' WHERE id = '00000000-0000-4000-8000-000000589033'$q$, '23514');
SELECT pg_temp.apply('00000000-0000-4000-8000-000000589034', '00000000-0000-4000-8000-000000589001', 'suspended', now() + interval '3 days');
SELECT pg_temp.assert_eq('a suspension that ended leaves room for a new one',
  (SELECT count(*)::text FROM account_sanctions WHERE user_id = '00000000-0000-4000-8000-000000589001' AND kind = 'suspended'), '3');

-- 6. The kinds the record knows, and the server's read of the suspensions not lifted.
SELECT pg_temp.assert_eq('the record knows four kinds of measure',
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'account_sanctions_kind' AND conrelid = 'public.account_sanctions'::regclass),
  'CHECK ((kind = ANY (ARRAY[''warning''::text, ''imports_blocked''::text, ''suspended''::text, ''closed''::text])))');
SELECT pg_temp.expect_error('a kind the record does not know',
  $q$SELECT pg_temp.apply(gen_random_uuid(), '00000000-0000-4000-8000-000000589001', 'fined', NULL)$q$, '23514');
SELECT pg_temp.assert_eq('the suspensions not lifted have their own index',
  (SELECT (indexdef LIKE '%(ends_at) WHERE ((kind = ''suspended''::text) AND (lifted_at IS NULL))')::text FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'account_sanctions_suspensions_idx'), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
