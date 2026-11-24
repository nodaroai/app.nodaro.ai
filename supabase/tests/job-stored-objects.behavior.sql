-- ============================================================================
-- Behavioral proof: record_job_stored_object (migration 695).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000068601 upward).
--
-- WHY THIS PROOF EXISTS. A video store keeps the provider's original beside
-- its preview and charges the job's owner for it here. Each assertion below is
-- an object charged twice, charged to the wrong account, recorded on a job
-- that already ended (an original no one deletes), or a refund of bytes that
-- were never charged, if it regresses.
--
-- Run locally (throwaway container; CI runs the image named below):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/job-stored-objects.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000068601', 'stored-owner@so.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000068602', 'stored-other@so.test', '{}', 'authenticated', 'authenticated');
UPDATE profiles SET storage_used_bytes = 0
 WHERE id IN ('00000000-0000-4000-8000-000000068601', '00000000-0000-4000-8000-000000068602');

INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-0000000686a1', '00000000-0000-4000-8000-000000068601', 'processing'),
  ('00000000-0000-4000-8000-0000000686a2', '00000000-0000-4000-8000-000000068601', 'cancelled'),
  ('00000000-0000-4000-8000-0000000686a3', '00000000-0000-4000-8000-000000068601', 'failed'),
  ('00000000-0000-4000-8000-0000000686a4', '00000000-0000-4000-8000-000000068601', 'pending'),
  ('00000000-0000-4000-8000-0000000686a5', '00000000-0000-4000-8000-000000068601', 'completed'),
  ('00000000-0000-4000-8000-0000000686a6', '00000000-0000-4000-8000-000000068602', 'processing'),
  ('00000000-0000-4000-8000-0000000686a7', '00000000-0000-4000-8000-000000068601', 'processing'),
  ('00000000-0000-4000-8000-0000000686a9', '00000000-0000-4000-8000-000000068601', 'queued'),
  ('00000000-0000-4000-8000-0000000686aa', '00000000-0000-4000-8000-000000068601', 'processing');

-- 1. A live job: its owner is charged the object's bytes, and the key records them.
SELECT pg_temp.assert_eq('live job: answer',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a1', 'videos/a1-master.mov', 9000, true, '{}'::jsonb)::text,
  '{"live": true, "charged": 9000}');
SELECT pg_temp.assert_eq('live job: owner charged',
  (SELECT storage_used_bytes::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000068601'), '9000');
SELECT pg_temp.assert_eq('live job: key records the charged bytes',
  (SELECT server_output->'stored'->>'videos/a1-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), '9000');

-- 2. A retry that stores the same key again is charged nothing more.
SELECT pg_temp.assert_eq('retry: answer',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a1', 'videos/a1-master.mov', 9000, true, '{}'::jsonb)::text,
  '{"live": true, "charged": 0}');
SELECT pg_temp.assert_eq('retry: owner charged once',
  (SELECT storage_used_bytes::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000068601'), '9000');

-- 3. The patch is merged beside the record.
SELECT public.record_job_stored_object('00000000-0000-4000-8000-0000000686a1', 'jobs/a1/raw.mov', 500, true,
  '{"rawExtensionUrl": "https://cdn.test/jobs/a1/raw.mov"}'::jsonb);
SELECT pg_temp.assert_eq('patch: merged',
  (SELECT server_output->>'rawExtensionUrl' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), 'https://cdn.test/jobs/a1/raw.mov');
SELECT pg_temp.assert_eq('patch: both keys recorded',
  (SELECT (server_output->'stored'->>'videos/a1-master.mov') || '/' || (server_output->'stored'->>'jobs/a1/raw.mov') FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), '9000/500');

-- 4. A cancelled or failed job records nothing and charges nothing.
SELECT pg_temp.assert_eq('cancelled job: not live, ended',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a2', 'videos/a2-master.mov', 7000, true, '{}'::jsonb)::text,
  '{"live": false, "ended": true}');
SELECT pg_temp.assert_eq('failed job: not live, ended',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a3', 'videos/a3-master.mov', 7000, true, '{}'::jsonb)::text,
  '{"live": false, "ended": true}');
-- A completed job (a second finalizer of a job already delivered): not live, and NOT ended — its object is never deleted.
SELECT pg_temp.assert_eq('completed job: not live, not ended',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a5', 'videos/a5-master.mov', 7000, true, '{}'::jsonb)::text,
  '{"live": false, "ended": false}');
SELECT pg_temp.assert_eq('ended jobs: no record',
  (SELECT count(*)::text FROM jobs WHERE id IN ('00000000-0000-4000-8000-0000000686a2', '00000000-0000-4000-8000-0000000686a3', '00000000-0000-4000-8000-0000000686a5') AND server_output IS NOT NULL), '0');
SELECT pg_temp.assert_eq('a missing job: not live',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686ff', 'videos/ff-master.mov', 7000, true, '{}'::jsonb)::text,
  '{"live": false, "ended": false}');
SELECT pg_temp.assert_eq('ended jobs: owner not charged',
  (SELECT storage_used_bytes::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000068601'), '9500');

-- 5. Without storage accounts (p_charge false): recorded as 0 charged, so a delete gives nothing back.
SELECT pg_temp.assert_eq('no charging: answer',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a4', 'videos/a4-master.mov', 4000, false, '{}'::jsonb)::text,
  '{"live": true, "charged": 0}');
SELECT pg_temp.assert_eq('no charging: recorded 0',
  (SELECT server_output->'stored'->>'videos/a4-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a4'), '0');

-- 6. Only the job's own owner is ever charged: a job of the other account charges that account.
SELECT public.record_job_stored_object('00000000-0000-4000-8000-0000000686a6', 'videos/a6-master.mov', 300, true, '{}'::jsonb);
SELECT pg_temp.assert_eq('the job''s owner charged',
  (SELECT storage_used_bytes::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000068602'), '300');
SELECT pg_temp.assert_eq('the other owner untouched by that job',
  (SELECT storage_used_bytes::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000068601'), '9500');

-- 6b. A re-store at a larger size charges only the difference; a smaller one charges nothing and keeps the record.
SELECT pg_temp.assert_eq('larger re-store: charges the difference',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a7', 'videos/a7-master.mov', 1000, true, '{}'::jsonb)::text
  || ' ' || public.record_job_stored_object('00000000-0000-4000-8000-0000000686a7', 'videos/a7-master.mov', 1500, true, '{}'::jsonb)::text,
  '{"live": true, "charged": 1000} {"live": true, "charged": 500}');
SELECT pg_temp.assert_eq('smaller re-store: charges nothing',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a7', 'videos/a7-master.mov', 800, true, '{}'::jsonb)::text,
  '{"live": true, "charged": 0}');
SELECT pg_temp.assert_eq('re-stores: recorded = charged',
  (SELECT server_output->'stored'->>'videos/a7-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a7'), '1500');

-- 6c. A negative size charges nothing and records nothing more.
SELECT pg_temp.assert_eq('negative size: nothing charged',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a7', 'videos/a7-neg.mov', -400, true, '{}'::jsonb)::text,
  '{"live": true, "charged": 0}');
SELECT pg_temp.assert_eq('negative size: recorded 0',
  (SELECT server_output->'stored'->>'videos/a7-neg.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a7'), '0');

-- 6d. A job with no owner charges no one and records 0 (where jobs.user_id may be NULL at all).
DO $$
DECLARE answer jsonb;
BEGIN
  INSERT INTO jobs (id, user_id, status) VALUES ('00000000-0000-4000-8000-0000000686a8', NULL, 'processing');
  answer := public.record_job_stored_object('00000000-0000-4000-8000-0000000686a8', 'videos/a8-master.mov', 700, true, '{}'::jsonb);
  IF answer IS DISTINCT FROM '{"live": true, "charged": 0}'::jsonb THEN
    RAISE EXCEPTION 'ASSERT FAIL [no owner]: got %', answer;
  END IF;
  RAISE NOTICE 'ok  a job with no owner charges no one';
EXCEPTION WHEN not_null_violation THEN
  RAISE NOTICE 'ok  a job always has an owner (jobs.user_id is NOT NULL)';
END $$;

-- 8. The claim: each recorded key once, its bytes answered, the record emptied of it.
SELECT pg_temp.assert_eq('claim: answers the owner and the recorded bytes',
  public.claim_job_stored_objects('00000000-0000-4000-8000-0000000686a7', ARRAY['videos/a7-master.mov', 'videos/not-recorded.mov'])::text,
  '{"owner": "00000000-0000-4000-8000-000000068601", "claimed": {"videos/a7-master.mov": 1500}}');
SELECT pg_temp.assert_eq('claim: the key is gone from the record, the others stay',
  (SELECT (server_output->'stored' ? 'videos/a7-master.mov')::text || '/' || (server_output->'stored' ? 'videos/a7-neg.mov')::text FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a7'), 'false/true');
-- A second claimant of the same key (the failure funnel and the worker both deleting it): nothing, so nothing is given back twice.
SELECT pg_temp.assert_eq('second claim: nothing',
  public.claim_job_stored_objects('00000000-0000-4000-8000-0000000686a7', ARRAY['videos/a7-master.mov'])::text,
  '{"owner": "00000000-0000-4000-8000-000000068601", "claimed": {}}');
-- The claim takes the row lock (FOR UPDATE) before reading the record, so two concurrent claimants serialize and the second sees the first's removal: pinned here by the function's definition.
SELECT pg_temp.assert_eq('claim: reads the record under the row lock',
  (SELECT (pg_get_functiondef('public.claim_job_stored_objects(uuid, text[])'::regprocedure) ~* 'FROM public\.jobs WHERE id = p_job_id FOR UPDATE')::text), 'true');
SELECT pg_temp.assert_eq('claim of a job with no record, and of none: empty',
  public.claim_job_stored_objects('00000000-0000-4000-8000-0000000686a2', ARRAY['x'])::text || ' ' || public.claim_job_stored_objects('00000000-0000-4000-8000-0000000686ff', ARRAY[]::text[])::text,
  '{"owner": "00000000-0000-4000-8000-000000068601", "claimed": {}} {"owner": null, "claimed": {}}');

-- 7a. A queued job is in flight: it records, and is charged.
SELECT pg_temp.assert_eq('queued job: live',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a9', 'videos/a9-master.mov', 50, true, '{}'::jsonb)::text,
  '{"live": true, "charged": 50}');

-- 7b. A discard of an unrecorded key: never of a recorded one; while it runs
-- and after it, a store that began before it records nothing; one that began
-- after it records.
SELECT pg_temp.assert_eq('discard of a recorded key: refused',
  public.discard_unrecorded_job_object('00000000-0000-4000-8000-0000000686a9', 'videos/a9-master.mov', 'begin')::text,
  '{"discard": false}');
SELECT pg_temp.assert_eq('discard of an unrecorded key: begins',
  public.discard_unrecorded_job_object('00000000-0000-4000-8000-0000000686aa', 'videos/aa-master.mov', 'begin')::text,
  '{"discard": true}');
SELECT pg_temp.assert_eq('record while the discard runs: refused',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686aa', 'videos/aa-master.mov', 10, true, '{}'::jsonb, now() + interval '1 minute')::text,
  '{"live": true, "discarded": true}');
SELECT public.discard_unrecorded_job_object('00000000-0000-4000-8000-0000000686aa', 'videos/aa-master.mov', 'done');
SELECT pg_temp.assert_eq('record by a store that began before the discard finished: refused',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686aa', 'videos/aa-master.mov', 10, true, '{}'::jsonb, now() - interval '1 minute')::text,
  '{"live": true, "discarded": true}');
SELECT pg_temp.assert_eq('record by a store that began after it: recorded',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686aa', 'videos/aa-master.mov', 10, true, '{}'::jsonb, now() + interval '1 minute')::text,
  '{"live": true, "charged": 10}');
SELECT pg_temp.assert_eq('the clock answers',
  (public.job_store_now() IS NOT NULL)::text, 'true');

-- 7b2. A patch alone (no key): merged on a live job, nothing recorded or charged.
SELECT public.record_job_stored_object('00000000-0000-4000-8000-0000000686a1', NULL, 0, false, '{"rawExtensionUrl": null}'::jsonb);
SELECT pg_temp.assert_eq('patch alone: the raw clip reference cleared',
  (SELECT coalesce(server_output->>'rawExtensionUrl', '<cleared>') FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), '<cleared>');
SELECT pg_temp.assert_eq('patch alone: the record kept',
  (SELECT server_output->'stored'->>'videos/a1-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), '9000');
SELECT pg_temp.assert_eq('patch alone on an ended job: refused',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a2', NULL, 0, false, '{"rawExtensionUrl": null}'::jsonb)::text,
  '{"live": false, "ended": true}');

-- 7b3. The periodic cleanup's two lookups (migration 695) read through their
-- partial indexes (migrations 696, 697) as the planner chooses them: on a
-- table where most rows are cancelled, failed or completed (so it would scan
-- otherwise), in a forced generic plan (the plan a cached call uses), with
-- sequential scans allowed. The plan is of the function's own body, prepared
-- with its two arguments as parameters.
INSERT INTO jobs (id, user_id, status)
SELECT gen_random_uuid(), '00000000-0000-4000-8000-000000068601', (ARRAY['completed', 'failed', 'cancelled'])[1 + (g % 3)]
  FROM generate_series(1, 30000) g;
INSERT INTO jobs (id, user_id, status, server_output) VALUES
  ('00000000-0000-4000-8000-0000000686b1', '00000000-0000-4000-8000-000000068601', 'cancelled', '{"stored": {"videos/b1-master.mov": 1}}'),
  ('00000000-0000-4000-8000-0000000686b2', '00000000-0000-4000-8000-000000068601', 'failed', '{"stored": {"videos/b2-master.mov": 1}}');
ANALYZE public.jobs;
SELECT pg_temp.assert_eq('the ended-jobs index exists',
  (SELECT count(*)::text FROM pg_indexes WHERE indexname = 'idx_jobs_ended_with_stored_objects'), '1');
SELECT pg_temp.assert_eq('the completed-unpruned index exists',
  (SELECT count(*)::text FROM pg_indexes WHERE indexname = 'idx_jobs_completed_unpruned'), '1');

CREATE FUNCTION pg_temp.body_plan(fn text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE body text;
DECLARE plan text := '';
DECLARE line text;
BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid = fn::regproc;
  body := regexp_replace(body, ';\s*$', '');
  body := replace(replace(body, 'p_after_id', '$1'), 'p_limit', '$2');
  EXECUTE 'PREPARE pg_temp_body(uuid, integer) AS ' || body;
  SET LOCAL plan_cache_mode = force_generic_plan;
  FOR line IN EXECUTE 'EXPLAIN EXECUTE pg_temp_body(NULL, 200)' LOOP
    plan := plan || line || E'\n';
  END LOOP;
  DEALLOCATE pg_temp_body;
  RETURN plan;
END $$;

DO $$
DECLARE plan text;
BEGIN
  IF current_setting('enable_seqscan') <> 'on' THEN RAISE EXCEPTION 'ASSERT FAIL [sequential scans must be allowed]'; END IF;
  plan := pg_temp.body_plan('public.ended_jobs_with_stored_objects');
  IF position('idx_jobs_ended_with_stored_objects' IN plan) = 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL [the ended-jobs lookup does not use its index]: %', plan;
  END IF;
  RAISE NOTICE 'ok  the ended-jobs lookup uses its partial index (generic plan, scans allowed)';
  plan := pg_temp.body_plan('public.completed_jobs_left_unpruned');
  IF position('idx_jobs_completed_unpruned' IN plan) = 0 THEN
    RAISE EXCEPTION 'ASSERT FAIL [the completed-unpruned lookup does not use its index]: %', plan;
  END IF;
  RAISE NOTICE 'ok  the completed-unpruned lookup uses its partial index (generic plan, scans allowed)';
END $$;
RESET plan_cache_mode;

-- Paging: a row the cleanup cannot clear stays, and the next page starts
-- after it, never at it.
DO $$
DECLARE first_id uuid;
DECLARE next_id uuid;
BEGIN
  SELECT id INTO first_id FROM public.ended_jobs_with_stored_objects(NULL, 1);
  SELECT id INTO next_id FROM public.ended_jobs_with_stored_objects(first_id, 1);
  IF first_id IS NULL OR next_id IS NULL OR next_id <= first_id THEN
    RAISE EXCEPTION 'ASSERT FAIL [paging does not advance]: % then %', first_id, next_id;
  END IF;
  IF (SELECT id FROM public.ended_jobs_with_stored_objects(NULL, 1)) IS DISTINCT FROM first_id THEN
    RAISE EXCEPTION 'ASSERT FAIL [the first page changed]';
  END IF;
  RAISE NOTICE 'ok  paging advances past a row that stays';
END $$;
SELECT pg_temp.assert_eq('the ended-jobs lookup finds a cancelled job holding an object',
  (SELECT stored::text FROM public.ended_jobs_with_stored_objects(NULL, 1000) WHERE id = '00000000-0000-4000-8000-0000000686b1'), '{"videos/b1-master.mov": 1}');
SELECT pg_temp.assert_eq('the lookup answers its owner too',
  (SELECT user_id::text FROM public.ended_jobs_with_stored_objects(NULL, 1000) WHERE id = '00000000-0000-4000-8000-0000000686b1'), '00000000-0000-4000-8000-000000068601');
INSERT INTO jobs (id, user_id, status, server_output)
SELECT gen_random_uuid(), '00000000-0000-4000-8000-000000068601', 'failed', '{"stored": {"videos/x-master.mov": 1}}' FROM generate_series(1, 1005);
SELECT pg_temp.assert_eq('a page is at most 1000 rows',
  (SELECT count(*)::text FROM public.ended_jobs_with_stored_objects(NULL, 5000)), '1000');
SELECT pg_temp.assert_eq('a negative limit answers nothing',
  (SELECT count(*)::text FROM public.ended_jobs_with_stored_objects(NULL, -5)), '0');

-- 7b4. A recorded object marks its job unpruned; mark_job_pruned clears the
-- mark on a completed job only; the completed-unpruned lookup finds it.
SELECT pg_temp.assert_eq('a record marks the job unpruned',
  (SELECT server_output->>'unpruned' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), 'true');
SELECT pg_temp.assert_eq('mark_job_pruned on a live job: nothing',
  public.mark_job_pruned('00000000-0000-4000-8000-0000000686a1')::text, 'false');
UPDATE jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-0000000686a1';
SELECT pg_temp.assert_eq('the completed-unpruned lookup finds it',
  (SELECT count(*)::text FROM public.completed_jobs_left_unpruned(NULL, 1000) WHERE id = '00000000-0000-4000-8000-0000000686a1'), '1');
SELECT pg_temp.assert_eq('mark_job_pruned on the completed job: done',
  public.mark_job_pruned('00000000-0000-4000-8000-0000000686a1')::text, 'true');
SELECT pg_temp.assert_eq('the mark is cleared',
  coalesce((SELECT server_output->>'unpruned' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), '<none>'), '<none>');
SELECT pg_temp.assert_eq('the record stays after the mark',
  (SELECT server_output->'stored'->>'videos/a1-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000686a1'), '9000');
UPDATE jobs SET status = 'processing' WHERE id = '00000000-0000-4000-8000-0000000686a1';

-- 7c. The service role may call every function.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('service_role: record',
  public.record_job_stored_object('00000000-0000-4000-8000-0000000686a9', 'videos/a9-other.mov', 5, false, '{}'::jsonb)::text,
  '{"live": true, "charged": 0}');
SELECT pg_temp.assert_eq('service_role: claim',
  public.claim_job_stored_objects('00000000-0000-4000-8000-0000000686a9', ARRAY['videos/a9-other.mov'])::text,
  '{"owner": "00000000-0000-4000-8000-000000068601", "claimed": {"videos/a9-other.mov": 0}}');
SELECT pg_temp.assert_eq('service_role: clock', (public.job_store_now() IS NOT NULL)::text, 'true');
SELECT pg_temp.assert_eq('service_role: mark pruned', public.mark_job_pruned('00000000-0000-4000-8000-0000000686ff')::text, 'false');
SELECT pg_temp.assert_eq('service_role: the ended-jobs lookup',
  (SELECT count(*)::text FROM public.ended_jobs_with_stored_objects(NULL, 1)), '1');
SELECT pg_temp.assert_eq('service_role: the completed-unpruned lookup',
  (SELECT (count(*) <= 1)::text FROM public.completed_jobs_left_unpruned(NULL, 1)), 'true');
RESET ROLE;

-- 7. No browser role may call either function, nor read the column.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.record_job_stored_object('00000000-0000-4000-8000-0000000686a1', 'k', 1, true, '{}'::jsonb);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls the record function]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call the record function';
END $$;
DO $$
BEGIN
  PERFORM public.claim_job_stored_objects('00000000-0000-4000-8000-0000000686a1', ARRAY['k']);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls the claim function]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call the claim function';
END $$;
DO $$
BEGIN
  PERFORM public.discard_unrecorded_job_object('00000000-0000-4000-8000-0000000686a1', 'k', 'begin');
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls the discard function]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call the discard function';
END $$;
DO $$
BEGIN
  PERFORM server_output FROM public.jobs LIMIT 1;
  RAISE EXCEPTION 'ASSERT FAIL [authenticated reads server_output]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot read server_output';
END $$;
DO $$
BEGIN
  PERFORM public.ended_jobs_with_stored_objects(NULL, 1);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls the ended-jobs lookup]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call the ended-jobs lookup';
END $$;
DO $$
BEGIN
  PERFORM public.completed_jobs_left_unpruned(NULL, 1);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls the completed-unpruned lookup]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call the completed-unpruned lookup';
END $$;
RESET ROLE;

-- 7d. Nor anon.
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.record_job_stored_object('00000000-0000-4000-8000-0000000686a1', 'k', 1, true, '{}'::jsonb);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls the record function]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call the record function';
END $$;
DO $$
BEGIN
  PERFORM public.claim_job_stored_objects('00000000-0000-4000-8000-0000000686a1', ARRAY['k']);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls the claim function]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call the claim function';
END $$;
DO $$
BEGIN
  PERFORM public.mark_job_pruned('00000000-0000-4000-8000-0000000686a1');
  RAISE EXCEPTION 'ASSERT FAIL [anon calls mark_job_pruned]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call mark_job_pruned';
END $$;
DO $$
BEGIN
  PERFORM public.job_store_now();
  RAISE EXCEPTION 'ASSERT FAIL [anon reads the store clock]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call the store clock';
END $$;
DO $$
BEGIN
  PERFORM public.ended_jobs_with_stored_objects(NULL, 1);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls the ended-jobs lookup]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call the ended-jobs lookup';
END $$;
DO $$
BEGIN
  PERFORM public.completed_jobs_left_unpruned(NULL, 1);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls the completed-unpruned lookup]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call the completed-unpruned lookup';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
