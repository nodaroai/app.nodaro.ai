-- ============================================================================
-- Behavioral proof: counter-notices (migration 587).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000c01 upward).
--
-- WHY THIS PROOF EXISTS. A counter-notice is a sworn statement: what the
-- sender submitted (their details, what they identified, the declaration,
-- when it was received and the restore window fixed then) never changes, it
-- is never deleted or truncated, there is one per restriction, and only the
-- restricted content's owner sends one, for a standing restriction of an open
-- copyright case. Each handling step is set once, stamped by the database,
-- with its administrator and its note written with it and never after; a
-- person named on it is never replaced, and only the removal of their
-- account clears the name. Across tables: every lift of a restriction
-- settles its counter-notice, a court action holds the content until it is
-- recorded as ended, and a case is not closed while a counter-notice on it
-- waits for a decision. Nothing is readable through PostgREST.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/rights-counter-notices.behavior.sql mig-test:/tmp/t.sql
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

-- A counter-notice for a restriction, from a sender, under a case: the submission's columns.
CREATE FUNCTION pg_temp.send(notice_id uuid, case_id uuid, restriction uuid, sender uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO rights_counter_notices (id, complaint_id, restriction_id, user_id, name_enc, email_enc, address_enc, phone_enc, signature_enc,
    content_identification, location_before, declaration_hash, perjury_affirmed_at, jurisdiction_affirmed_at, window_opens_on, window_closes_on)
  VALUES (notice_id, case_id, restriction, sender, 'n', 'e', 'a', 'p', 's', 'my clip', 'https://cdn.example.test/v.mp4', 'decl', now(), now(),
    DATE '2026-12-09', DATE '2026-12-11');
$$;

-- The sender, two administrators, and someone else.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000c01', 'cn-owner@cn.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000c02', 'cn-admin@cn.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000c03', 'cn-admin2@cn.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000c04', 'cn-other@cn.test', '{}', 'authenticated', 'authenticated');

-- The case, another open case, a complaint of another kind, and a closed case.
INSERT INTO rights_complaints (id, kind, category, status, complainant_name_enc, complainant_email_enc, complainant_email_hash, reported_content, explanation) VALUES
  ('00000000-0000-4000-8000-000000000c11', 'copyright', 'copyright_infringement', 'content_restricted', 'enc-name', 'enc-email', 'hash-cn', 'https://cdn.example.test/v.mp4', 'mine'),
  ('00000000-0000-4000-8000-000000000c12', 'copyright', 'copyright_infringement', 'received', 'enc-name', 'enc-email', 'hash-cn', 'https://cdn.example.test/w.mp4', 'mine'),
  ('00000000-0000-4000-8000-000000000c13', 'other', 'privacy', 'content_restricted', 'enc-name', 'enc-email', 'hash-cn', 'https://cdn.example.test/x.mp4', 'me'),
  ('00000000-0000-4000-8000-000000000c14', 'copyright', 'copyright_infringement', 'closed', 'enc-name', 'enc-email', 'hash-cn', 'https://cdn.example.test/y.mp4', 'mine');

-- The owner's restrictions: one per scenario.
INSERT INTO content_restrictions (id, reason, complaint_id, owner_user_id, r2_keys, lifted_at) VALUES
  ('00000000-0000-4000-8000-000000000c21', 'the claimant''s film', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', '{uploads/v.mp4}', NULL),
  ('00000000-0000-4000-8000-000000000c22', 'another', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', '{uploads/w.mp4}', NULL),
  ('00000000-0000-4000-8000-000000000c23', 'lifted', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', '{uploads/l.mp4}', now()),
  ('00000000-0000-4000-8000-000000000c24', 'privacy', '00000000-0000-4000-8000-000000000c13', '00000000-0000-4000-8000-000000000c01', '{uploads/x.mp4}', NULL),
  ('00000000-0000-4000-8000-000000000c25', 'closed case', '00000000-0000-4000-8000-000000000c14', '00000000-0000-4000-8000-000000000c01', '{uploads/y.mp4}', NULL),
  ('00000000-0000-4000-8000-000000000c26', 'court', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', '{uploads/c.mp4}', NULL),
  ('00000000-0000-4000-8000-000000000c27', 'lifted by the general route', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', '{uploads/g.mp4}', NULL),
  ('00000000-0000-4000-8000-000000000c28', 'declined', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', '{uploads/d.mp4}', NULL);

-- 1. A counter-notice is received with a server-made reference and its window.
SELECT pg_temp.send('00000000-0000-4000-8000-000000000c31', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c01');
SELECT pg_temp.assert_eq('the reference is made by the server',
  (SELECT (reference ~ '^CN-\d{4}-\d{6}$')::text FROM rights_counter_notices WHERE id = '00000000-0000-4000-8000-000000000c31'), 'true');
SELECT pg_temp.expect_error('one counter-notice per restriction',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c01')$q$, '23505');
SELECT pg_temp.expect_error('a window cannot close before it opens',
  $q$INSERT INTO rights_counter_notices (complaint_id, restriction_id, user_id, name_enc, email_enc, address_enc, phone_enc, signature_enc, content_identification, location_before, declaration_hash, perjury_affirmed_at, jurisdiction_affirmed_at, window_opens_on, window_closes_on) VALUES ('00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c22', '00000000-0000-4000-8000-000000000c01', 'n', 'e', 'a', 'p', 's', 'x', 'y', 'd', now(), now(), DATE '2026-12-11', DATE '2026-12-08')$q$, '23514');
SELECT pg_temp.expect_error('a counter-notice answers a restriction that exists',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000cff', '00000000-0000-4000-8000-000000000c01')$q$, '23503');
SELECT pg_temp.expect_error('a counter-notice arrives with no step taken',
  $q$INSERT INTO rights_counter_notices (complaint_id, restriction_id, user_id, name_enc, email_enc, address_enc, phone_enc, signature_enc, content_identification, location_before, declaration_hash, perjury_affirmed_at, jurisdiction_affirmed_at, window_opens_on, window_closes_on, forwarded_at) VALUES ('00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c22', '00000000-0000-4000-8000-000000000c01', 'n', 'e', 'a', 'p', 's', 'x', 'y', 'd', now(), now(), DATE '2026-12-09', DATE '2026-12-11', now())$q$, '55000');

-- 2. Only the owner, for a standing restriction of an open copyright case, as the case it followed.
SELECT pg_temp.expect_error('not for a lifted restriction',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c23', '00000000-0000-4000-8000-000000000c01')$q$, '55027');
SELECT pg_temp.expect_error('not from someone else',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c22', '00000000-0000-4000-8000-000000000c04')$q$, '55027');
SELECT pg_temp.expect_error('not without a sender',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c22', NULL)$q$, '55027');
SELECT pg_temp.expect_error('not under another case',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c12', '00000000-0000-4000-8000-000000000c22', '00000000-0000-4000-8000-000000000c01')$q$, '55027');
SELECT pg_temp.expect_error('not for another kind of complaint',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c13', '00000000-0000-4000-8000-000000000c24', '00000000-0000-4000-8000-000000000c01')$q$, '55027');
SELECT pg_temp.expect_error('not for a closed case',
  $q$SELECT pg_temp.send(gen_random_uuid(), '00000000-0000-4000-8000-000000000c14', '00000000-0000-4000-8000-000000000c25', '00000000-0000-4000-8000-000000000c01')$q$, '55027');

-- 3. What was submitted never changes; it is never deleted.
SELECT pg_temp.expect_error('the sender''s details cannot be edited',
  $q$UPDATE rights_counter_notices SET email_enc = 'other' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('what was identified cannot be edited',
  $q$UPDATE rights_counter_notices SET content_identification = 'changed' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('the window cannot be moved',
  $q$UPDATE rights_counter_notices SET window_opens_on = DATE '2026-12-01' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('the receipt cannot be redated',
  $q$UPDATE rights_counter_notices SET received_at = now() - interval '30 days' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('the reference cannot be edited',
  $q$UPDATE rights_counter_notices SET reference = 'CN-2000-000001' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('a counter-notice cannot be deleted',
  $q$DELETE FROM rights_counter_notices WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');

-- 4. A step is stamped by the database, set once, with its administrator written with it.
UPDATE rights_counter_notices SET forwarded_at = TIMESTAMPTZ '2001-01-01', forwarded_by = '00000000-0000-4000-8000-000000000c02'
 WHERE id = '00000000-0000-4000-8000-000000000c31';
SELECT pg_temp.assert_eq('a step is stamped with the database''s clock, never backdated',
  (SELECT (forwarded_at > TIMESTAMPTZ '2020-01-01')::text FROM rights_counter_notices WHERE id = '00000000-0000-4000-8000-000000000c31'), 'true');
SELECT pg_temp.expect_error('a forwarding is not redated',
  $q$UPDATE rights_counter_notices SET forwarded_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('a forwarding is not undone',
  $q$UPDATE rights_counter_notices SET forwarded_at = NULL WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('a step''s administrator is not replaced',
  $q$UPDATE rights_counter_notices SET forwarded_by = '00000000-0000-4000-8000-000000000c03' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('a step''s administrator is not cleared while that account exists',
  $q$UPDATE rights_counter_notices SET forwarded_by = NULL WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('an administrator is written with the step, never without it',
  $q$UPDATE rights_counter_notices SET court_action_by = '00000000-0000-4000-8000-000000000c02' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('a note is written with its step, never without it',
  $q$UPDATE rights_counter_notices SET court_action_note_enc = 'enc-note' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('the sender is not replaced',
  $q$UPDATE rights_counter_notices SET user_id = '00000000-0000-4000-8000-000000000c03' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('a court action ends only after it was received',
  $q$UPDATE rights_counter_notices SET court_action_ended_at = now(), court_action_ended_by = '00000000-0000-4000-8000-000000000c02' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '23514');
SELECT pg_temp.expect_error('a decline says why',
  $q$UPDATE rights_counter_notices SET declined_at = now(), declined_by = '00000000-0000-4000-8000-000000000c02' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '23514');
SELECT pg_temp.expect_error('a counter-notice is marked restored only once its restriction is lifted',
  $q$UPDATE rights_counter_notices SET restored_at = now(), restored_by = '00000000-0000-4000-8000-000000000c02' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');

-- 5. The window's notes: claimed from null, released to null, never redated.
UPDATE rights_counter_notices SET window_opened_noted_at = now() WHERE id = '00000000-0000-4000-8000-000000000c31';
SELECT pg_temp.expect_error('a window note is not redated',
  $q$UPDATE rights_counter_notices SET window_opened_noted_at = now() + interval '1 day' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
UPDATE rights_counter_notices SET window_opened_noted_at = NULL WHERE id = '00000000-0000-4000-8000-000000000c31';
SELECT pg_temp.assert_eq('a window note whose note failed is released',
  (SELECT (window_opened_noted_at IS NULL)::text FROM rights_counter_notices WHERE id = '00000000-0000-4000-8000-000000000c31'), 'true');

-- 6. The case is not closed while a counter-notice on it waits for a decision.
SELECT pg_temp.expect_error('a case with a waiting counter-notice is not closed',
  $q$UPDATE rights_complaints SET status = 'closed', closed_at = now() WHERE id = '00000000-0000-4000-8000-000000000c11'$q$, '55026');
SELECT pg_temp.expect_error('nor resolved',
  $q$UPDATE rights_complaints SET status = 'resolved', closed_at = now() WHERE id = '00000000-0000-4000-8000-000000000c11'$q$, '55026');

-- 7. A court action holds the content, by every route, until it is recorded as ended.
SELECT pg_temp.send('00000000-0000-4000-8000-000000000c32', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c26', '00000000-0000-4000-8000-000000000c01');
UPDATE rights_counter_notices SET court_action_at = now(), court_action_by = '00000000-0000-4000-8000-000000000c02', court_action_note_enc = 'enc-note'
 WHERE id = '00000000-0000-4000-8000-000000000c32';
SELECT pg_temp.expect_error('a court action''s note is not rewritten',
  $q$UPDATE rights_counter_notices SET court_action_note_enc = 'enc-other' WHERE id = '00000000-0000-4000-8000-000000000c32'$q$, '55000');
SELECT pg_temp.expect_error('no lift while a court action holds the content',
  $q$SELECT lift_content_restriction('00000000-0000-4000-8000-000000000c26', '00000000-0000-4000-8000-000000000c03', 'lift')$q$, '55025');
SELECT pg_temp.expect_error('nor by any other writer of the restriction',
  $q$UPDATE content_restrictions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000000c03', lift_reason = 'lift' WHERE id = '00000000-0000-4000-8000-000000000c26'$q$, '55025');
SELECT pg_temp.assert_eq('the refused lift left the restriction standing',
  (SELECT (lifted_at IS NULL)::text FROM content_restrictions WHERE id = '00000000-0000-4000-8000-000000000c26'), 'true');
UPDATE rights_counter_notices SET court_action_ended_at = now(), court_action_ended_by = '00000000-0000-4000-8000-000000000c02', court_action_ended_note_enc = 'enc-ended'
 WHERE id = '00000000-0000-4000-8000-000000000c32';
SELECT (lift_content_restriction('00000000-0000-4000-8000-000000000c26', '00000000-0000-4000-8000-000000000c03', 'the court action ended')).id;
SELECT pg_temp.assert_eq('once the court action ended, the lift restores and settles the counter-notice',
  (SELECT (restored_at IS NOT NULL)::text || ',' || restored_by::text FROM rights_counter_notices WHERE id = '00000000-0000-4000-8000-000000000c32'),
  'true,00000000-0000-4000-8000-000000000c03');

-- 8. Every lift settles its counter-notice, whoever lifts; a restored one takes no court action after.
SELECT pg_temp.send('00000000-0000-4000-8000-000000000c33', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c27', '00000000-0000-4000-8000-000000000c01');
UPDATE content_restrictions SET lifted_at = now(), lifted_by = '00000000-0000-4000-8000-000000000c02', lift_reason = 'the complaint was withdrawn'
 WHERE id = '00000000-0000-4000-8000-000000000c27';
SELECT pg_temp.assert_eq('a lift by any writer stamps the restore in its own transaction',
  (SELECT (restored_at IS NOT NULL)::text || ',' || restored_by::text FROM rights_counter_notices WHERE id = '00000000-0000-4000-8000-000000000c33'),
  'true,00000000-0000-4000-8000-000000000c02');
SELECT pg_temp.expect_error('no court action on restored content',
  $q$UPDATE rights_counter_notices SET court_action_at = now(), court_action_by = '00000000-0000-4000-8000-000000000c02' WHERE id = '00000000-0000-4000-8000-000000000c33'$q$, '23514');
SELECT pg_temp.expect_error('not even with its end written at once',
  $q$UPDATE rights_counter_notices SET court_action_at = now(), court_action_by = '00000000-0000-4000-8000-000000000c02', court_action_ended_at = now(), court_action_ended_by = '00000000-0000-4000-8000-000000000c02' WHERE id = '00000000-0000-4000-8000-000000000c33'$q$, '23514');

-- 9. A declined counter-notice: its reason written with it, and no court action after.
SELECT pg_temp.send('00000000-0000-4000-8000-000000000c34', '00000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c28', '00000000-0000-4000-8000-000000000c01');
UPDATE rights_counter_notices SET declined_at = now(), declined_by = '00000000-0000-4000-8000-000000000c02', declined_reason = 'No physical address was given.'
 WHERE id = '00000000-0000-4000-8000-000000000c34';
SELECT pg_temp.expect_error('a decline''s reason is not rewritten',
  $q$UPDATE rights_counter_notices SET declined_reason = 'Another reason.' WHERE id = '00000000-0000-4000-8000-000000000c34'$q$, '55000');
SELECT pg_temp.expect_error('no court action on a declined counter-notice',
  $q$UPDATE rights_counter_notices SET court_action_at = now(), court_action_by = '00000000-0000-4000-8000-000000000c02' WHERE id = '00000000-0000-4000-8000-000000000c34'$q$, '23514');

-- 10. Once nothing waits (the last one restored), the case closes.
SELECT (lift_content_restriction('00000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c02', 'restored after the counter-notice')).id;
UPDATE rights_complaints SET status = 'closed', closed_at = now() WHERE id = '00000000-0000-4000-8000-000000000c11';
SELECT pg_temp.assert_eq('the case closes once every counter-notice is decided',
  (SELECT status FROM rights_complaints WHERE id = '00000000-0000-4000-8000-000000000c11'), 'closed');
SELECT pg_temp.expect_error('a restore is not undone',
  $q$UPDATE rights_counter_notices SET restored_at = NULL, restored_by = NULL WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');

-- 11. Never truncated.
SELECT pg_temp.expect_error('the counter-notices cannot be truncated',
  $q$TRUNCATE rights_counter_notices$q$, '55000');

-- 12. A removed account leaves the record: its name clears, nothing else moves, and no one takes its place.
DELETE FROM auth.users WHERE id IN ('00000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-000000000c02');
SELECT pg_temp.assert_eq('the record outlives the accounts it named',
  (SELECT (user_id IS NULL)::text || ',' || (forwarded_by IS NULL)::text || ',' || (forwarded_at IS NOT NULL)::text || ',' || (restored_by IS NULL)::text || ',' || content_identification
   FROM rights_counter_notices WHERE id = '00000000-0000-4000-8000-000000000c31'), 'true,true,true,true,my clip');
SELECT pg_temp.expect_error('a cleared sender is never filled in with someone else',
  $q$UPDATE rights_counter_notices SET user_id = '00000000-0000-4000-8000-000000000c03' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');
SELECT pg_temp.expect_error('a cleared administrator is never filled in with someone else',
  $q$UPDATE rights_counter_notices SET forwarded_by = '00000000-0000-4000-8000-000000000c03' WHERE id = '00000000-0000-4000-8000-000000000c31'$q$, '55000');

-- 13. Nothing through PostgREST.
SELECT pg_temp.assert_eq('revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'rights_counter_notices' AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('the reference sequence is revoked too',
  (SELECT (has_sequence_privilege('anon', 'public.rights_counter_notices_reference_seq', 'USAGE') OR has_sequence_privilege('authenticated', 'public.rights_counter_notices_reference_seq', 'USAGE'))::text), 'false');
SELECT pg_temp.assert_eq('rls on', (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'rights_counter_notices'), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
