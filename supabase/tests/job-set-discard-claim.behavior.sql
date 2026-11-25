-- ============================================================================
-- Behavioral proof: claim_job_set_discard / finish_job_set_discard (710).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000070401 upward).
--
-- WHY THIS PROOF EXISTS. Every clean-up of a set job's pictures gives their
-- bytes back to the owner. Two clean-ups that both win would give them back
-- twice; one that never wins (a crashed claim never taken over) leaves them
-- stored and counted. Each assertion below is one of those if it regresses.
--
-- Run locally (throwaway container; CI runs the image named in
-- job-stored-objects.behavior.sql):
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/job-set-discard-claim.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000070401', 'set-owner@sd.test', '{}', 'authenticated', 'authenticated');

INSERT INTO jobs (id, user_id, status, server_output) VALUES
  ('00000000-0000-4000-8000-0000000704a1', '00000000-0000-4000-8000-000000070401', 'failed', '{"stored": {"videos/k.mov": 10}}'),
  ('00000000-0000-4000-8000-0000000704a2', '00000000-0000-4000-8000-000000070401', 'processing', NULL),
  ('00000000-0000-4000-8000-0000000704a3', '00000000-0000-4000-8000-000000070401', 'cancelled', NULL),
  ('00000000-0000-4000-8000-0000000704a4', '00000000-0000-4000-8000-000000070401', 'completed', NULL);

-- 1. The first claim on an ended row wins; a second, while it is live, does not.
SELECT pg_temp.assert_eq('first claim wins',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a1', ARRAY['failed', 'cancelled']) IS NOT NULL)::text, 'true');
SELECT pg_temp.assert_eq('second claim while live loses',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a1', ARRAY['failed', 'cancelled']) IS NULL)::text, 'true');
SELECT pg_temp.assert_eq('other keys of server_output are kept',
  (SELECT server_output->'stored'->>'videos/k.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000704a1'), '10');

-- 2. A row not in the caller's statuses is never claimed.
SELECT pg_temp.assert_eq('a live job is never claimed',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a2', ARRAY['failed', 'cancelled']) IS NULL)::text, 'true');
SELECT pg_temp.assert_eq('a completed job is claimed only by a caller that may clean one up',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a4', ARRAY['failed', 'cancelled']) IS NULL)::text, 'true');
SELECT pg_temp.assert_eq('... and by that caller',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a4', ARRAY['completed']) IS NOT NULL)::text, 'true');

-- 3. Finished: only with its own claim; then a later clean-up may claim again.
SELECT pg_temp.assert_eq('finish with a wrong claim does nothing',
  public.finish_job_set_discard('00000000-0000-4000-8000-0000000704a1', '1999-01-01T00:00:00+00:00')::text, 'false');
SELECT pg_temp.assert_eq('finish with its own claim',
  public.finish_job_set_discard('00000000-0000-4000-8000-0000000704a1',
    (SELECT server_output->'setDiscard'->>'claimedAt' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000704a1'))::text, 'true');
SELECT pg_temp.assert_eq('after it finished, a later clean-up claims again',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a1', ARRAY['failed', 'cancelled']) IS NOT NULL)::text, 'true');

-- 4. A claim never finished and older than the stale window is taken over.
UPDATE jobs SET server_output = jsonb_build_object('setDiscard', jsonb_build_object('claimedAt', to_jsonb(clock_timestamp() - interval '20 minutes')))
 WHERE id = '00000000-0000-4000-8000-0000000704a3';
SELECT pg_temp.assert_eq('a stale claim is taken over',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a3', ARRAY['failed', 'cancelled']) IS NOT NULL)::text, 'true');
UPDATE jobs SET server_output = jsonb_build_object('setDiscard', jsonb_build_object('claimedAt', to_jsonb(clock_timestamp() - interval '5 minutes')))
 WHERE id = '00000000-0000-4000-8000-0000000704a3';
SELECT pg_temp.assert_eq('a recent claim is not',
  (public.claim_job_set_discard('00000000-0000-4000-8000-0000000704a3', ARRAY['failed', 'cancelled']) IS NULL)::text, 'true');

-- 5. Closed to browser roles.
SELECT pg_temp.assert_eq('anon cannot call the claim',
  has_function_privilege('anon', 'public.claim_job_set_discard(uuid, text[])', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot call the claim',
  has_function_privilege('authenticated', 'public.claim_job_set_discard(uuid, text[])', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot call the finish',
  has_function_privilege('authenticated', 'public.finish_job_set_discard(uuid, text)', 'EXECUTE')::text, 'false');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
