-- ============================================================================
-- Behavioral proof: `pending_review` is a status only the PLATFORM can write
-- (migrations 377 + 378 + 379).
--
-- WHY THIS FILE EXISTS. 377 widens `jobs_status_check` to admit
-- 'pending_review'. That value is the ONLY authority the review queue has:
-- `admin-review.ts` lists `.eq("status","pending_review")` and the hold-decision
-- join is decoration, not a filter. Migration 347:54-56 deliberately left the
-- table-level INSERT grant on `jobs` alone ("the browser never writes jobs, but
-- narrowing writes is a separate change with its own blast radius"), and the
-- one INSERT policy on `jobs` only asks `auth.uid() = user_id` -- so before
-- this change a signed-in user could POST /rest/v1/jobs with
-- `status='pending_review'` and their own `held_objects`, and the row appeared
-- in the operator's queue. With `held_at` NULL the TTL sweep
-- (`lib/reconcile/hold-expiry.ts:68` `.lt('held_at', cutoff)`) never selected
-- it either, so it sat there until a human rejected it.
--
-- Grants and policies are not provable from SQL text -- a WITH CHECK reads
-- correct and admits the row anyway -- so this runs the real privilege system.
--
-- Own uuid range ...-000000000961 upward.
--
-- Run locally: same recipe as supabase/tests/jobs-cost-privacy.behavior.sql
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
  ('00000000-0000-4000-8000-000000000961', 'hold-owner@hold.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('the profile was created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000961'), '1');

-- ------------------------------------------------------------------ schema
-- 0. Not vacuous. If a later migration narrows the CHECK back, or renumbers
--    379 away, every assertion below would pass for the wrong reason.
SELECT pg_temp.assert_eq('377 widened jobs_status_check to admit pending_review',
  (SELECT count(*)::text FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_status_check'
      AND pg_get_constraintdef(oid) LIKE '%pending_review%'), '1');
SELECT pg_temp.assert_eq('...and 378 validated it (NOT VALID would skip existing rows forever)',
  (SELECT convalidated::text FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_status_check'), 'true');
SELECT pg_temp.assert_eq('379 built the queue index the review page pages on',
  (SELECT count(*)::text FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'jobs' AND indexname = 'idx_jobs_pending_review'), '1');
SELECT pg_temp.assert_eq('the policyId filter has a partial index whose LEADING column is policy_id',
  (SELECT count(*)::text FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'job_policy_decisions'
      AND indexname = 'idx_job_policy_decisions_policy_holds'), '1');

-- ------------------------------------------------------------ the platform
-- 1. The service-role funnel is untouched: the gate parks a job exactly this
--    way (`markJobHeld` -> status + held_output_data + held_objects + held_at).
INSERT INTO jobs (id, user_id, job_type, status, held_output_data, held_objects, held_at, credits)
VALUES ('f0000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000961',
        'generate-image', 'pending_review',
        '{"imageUrl":"https://cdn.example/held.png"}'::jsonb,
        '[{"key":"images/f0000000-0000-4000-8000-000000000961.png","kind":"image","index":0}]'::jsonb,
        NOW(), 4);
SELECT pg_temp.assert_eq('the platform can park a job in pending_review',
  (SELECT status FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000961'), 'pending_review');

-- -------------------------------------------------------------- the browser
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000961","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000961';

-- 2. THE HOLE. A signed-in user planting their OWN queue row. The insert names
--    a real user_id, so the `auth.uid() = user_id` half of the policy passes;
--    only the status clause can refuse it.
DO $$ BEGIN
  INSERT INTO jobs (id, user_id, job_type, status, held_output_data, held_objects, credits)
  VALUES ('f0000000-0000-4000-8000-000000000962', '00000000-0000-4000-8000-000000000961',
          'generate-image', 'pending_review',
          '{"imageUrl":"https://evil.example/plant.png"}'::jsonb,
          '[{"key":"images/some-other-job.png","kind":"image","index":0}]'::jsonb, 0);
  RAISE EXCEPTION 'ASSERT FAIL: a user planted a pending_review row in the operator queue';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'ok  a user cannot insert a pending_review job (refused)';
END $$;
SELECT pg_temp.assert_eq('...and no such row exists',
  (SELECT count(*)::text FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-000000000962'), '0');

-- 3. The escalation is closed on the other side too: `jobs` has no UPDATE
--    policy at all, so "insert pending, then flip to pending_review" writes
--    zero rows rather than erroring. Asserted as a behaviour because a future
--    migration that adds an owner UPDATE policy would silently reopen it.
DO $$
DECLARE v_flipped int;
BEGIN
  WITH u AS (
    UPDATE jobs SET status = 'pending_review'
     WHERE id = 'f0000000-0000-4000-8000-000000000961' RETURNING 1
  ) SELECT count(*) INTO v_flipped FROM u;
  IF v_flipped <> 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL: a user flipped their own job to pending_review';
  END IF;
  RAISE NOTICE 'ok  a user cannot UPDATE a job into pending_review (no UPDATE policy)';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
  RAISE NOTICE 'ok  a user cannot UPDATE a job into pending_review (refused)';
END $$;

-- 4. The tightening is SURGICAL: this is a status filter, not a write ban.
--    347 deliberately left the INSERT grant alone and narrowing it is a
--    separate change with its own blast radius, so the grant is unchanged and
--    every other status a browser could already write still passes.
SELECT pg_temp.assert_eq('the table-level INSERT grant on jobs is unchanged (347:54-56 stands)',
  has_table_privilege('authenticated', 'public.jobs', 'INSERT')::text, 'true');

-- 5. The withheld payload stays unreadable regardless: 347 granted back four
--    columns and `held_*` is on neither list, so even the owner of a parked row
--    cannot read what was withheld from them.
SELECT pg_temp.assert_eq('the owner cannot SELECT jobs.held_output_data',
  has_column_privilege('authenticated', 'public.jobs', 'held_output_data', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('the owner cannot SELECT jobs.held_objects',
  has_column_privilege('authenticated', 'public.jobs', 'held_objects', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('the owner cannot SELECT jobs.held_completion_fields',
  has_column_privilege('authenticated', 'public.jobs', 'held_completion_fields', 'SELECT')::text, 'false');

-- 6. The audit table is service-role only (377 enables RLS with no policies AND
--    revokes) — a moderation reason is the deployment's business.
DO $$ BEGIN
  PERFORM count(*) FROM public.job_policy_decisions;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated can read job_policy_decisions';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot SELECT job_policy_decisions';
END $$;

RESET ROLE;

-- 7. ...and the backend is not locked out of any of it.
SELECT pg_temp.assert_eq('service_role still writes job_policy_decisions',
  has_table_privilege('service_role', 'public.job_policy_decisions', 'INSERT')::text, 'true');
SELECT pg_temp.assert_eq('service_role still reads jobs.held_output_data',
  has_column_privilege('service_role', 'public.jobs', 'held_output_data', 'SELECT')::text, 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
