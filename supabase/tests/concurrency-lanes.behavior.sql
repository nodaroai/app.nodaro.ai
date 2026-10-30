-- ============================================================================
-- Behavioral proof: concurrency lanes (migrations 568 and 569, the
-- queued-jobs index).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000568xx).
--
-- The four lane tables are configuration and queue bookkeeping the server
-- alone reads and writes. `lane_requeue_payloads` matters most: a parked
-- job's BullMQ payload carries its billing context (a deployment payer's id),
-- which no user may read. Each assertion below fails if a later migration
-- opens one of them to a client role, drops a default the tolerant readers
-- rely on, or loses the queued-jobs index.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/concurrency-lanes.behavior.sql mig-test:/tmp/t.sql
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

-- 1. The four tables: RLS on, one service-role policy, no client privilege.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lane_plan_sizes', 'lane_user_overrides', 'lane_provider_ceilings', 'lane_requeue_payloads'] LOOP
    PERFORM pg_temp.assert_eq(t || ': RLS is on',
      (SELECT relrowsecurity::text FROM pg_class WHERE oid = ('public.' || t)::regclass), 'true');
    PERFORM pg_temp.assert_eq(t || ': the only policy is service_role_all, for the service role',
      (SELECT string_agg(policyname || ':' || array_to_string(roles, ','), ';') FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t), 'service_role_all:service_role');
    PERFORM pg_temp.assert_eq(t || ': anon has no privilege',
      has_table_privilege('anon', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE')::text, 'false');
    PERFORM pg_temp.assert_eq(t || ': authenticated has no privilege',
      has_table_privilege('authenticated', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE')::text, 'false');
    PERFORM pg_temp.assert_eq(t || ': the service role has every privilege',
      has_table_privilege('service_role', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE')::text, 'true');
  END LOOP;
END $$;

-- 2. The seeded plan sizes (provider = the plan's parallelism; llm and local =
--    max(3 / 4, 2 × provider); run = provider; enterprise = business's sizes).
SELECT pg_temp.assert_eq('lane_plan_sizes seed',
  (SELECT string_agg(format('%s=%s/%s/%s/%s', tier, provider, llm, local, run), ' ' ORDER BY provider, tier)
     FROM public.lane_plan_sizes),
  'free=2/4/4/2 basic=4/8/8/4 payg=4/8/8/4 standard=6/12/12/6 pro=10/20/20/10 business=12/24/24/12 enterprise=12/24/24/12');

-- ...and a size outside 1–500 is refused.
DO $$ BEGIN
  UPDATE public.lane_plan_sizes SET llm = 0 WHERE tier = 'free';
  RAISE EXCEPTION 'ASSERT FAIL: a lane size of 0 was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  a lane size of 0 is refused';
END $$;
DO $$ BEGIN
  UPDATE public.lane_plan_sizes SET provider = 501 WHERE tier = 'free';
  RAISE EXCEPTION 'ASSERT FAIL: a lane size of 501 was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  a lane size of 501 is refused';
END $$;
DO $$ BEGIN
  INSERT INTO public.lane_provider_ceilings (provider, ceiling) VALUES ('kie', 0);
  RAISE EXCEPTION 'ASSERT FAIL: a provider ceiling of 0 was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  a provider ceiling of 0 is refused';
END $$;
DO $$ BEGIN
  INSERT INTO public.lane_requeue_payloads (kind, row_id, bull_queue, bull_job_id, name, data, opts)
    VALUES ('render', gen_random_uuid(), 'video', '1', 'x', '{}', '{}');
  RAISE EXCEPTION 'ASSERT FAIL: an unknown requeue kind was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  an unknown requeue kind is refused';
END $$;

-- 3. The three settings.
SELECT pg_temp.assert_eq('settings',
  (SELECT string_agg(key || '=' || value::text, ' ' ORDER BY key) FROM public.app_settings
    WHERE key IN ('lane_queue_timeout_minutes', 'lane_live_wait_minutes', 'lanes_enforced')),
  'lane_live_wait_minutes=10 lane_queue_timeout_minutes=120 lanes_enforced={}');

-- 4. Every queue column, its type, nullability and default.
SELECT pg_temp.assert_eq('queue columns',
  (SELECT string_agg(format('%s.%s:%s:%s:%s', table_name, column_name, data_type, is_nullable, coalesce(column_default, '-')), ' '
            ORDER BY table_name, column_name)
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('jobs', 'workflow_executions', 'pipelines')
      AND column_name LIKE 'lane\_%'),
  'jobs.lane_bull_job_id:text:YES:- jobs.lane_bull_queue:text:YES:- jobs.lane_env:text:YES:- '
  || 'jobs.lane_env_id:text:YES:- jobs.lane_queued_at:timestamp with time zone:YES:- jobs.lane_wait_ms:bigint:NO:0 '
  || 'pipelines.lane_env:text:YES:- pipelines.lane_env_id:text:YES:- pipelines.lane_queued_at:timestamp with time zone:YES:- '
  || 'pipelines.lane_wait_ms:bigint:NO:0 '
  || 'workflow_executions.lane_env:text:YES:- workflow_executions.lane_env_id:text:YES:- '
  || 'workflow_executions.lane_queued_at:timestamp with time zone:YES:- workflow_executions.lane_wait_ms:bigint:NO:0');

-- The jobs stamps stay private like every column 347 did not grant: a user's
-- browser never reads which queue or BullMQ id a row is parked under.
SELECT pg_temp.assert_eq('authenticated cannot read jobs.lane_bull_job_id',
  has_column_privilege('authenticated', 'public.jobs', 'lane_bull_job_id', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot read jobs.lane_env',
  has_column_privilege('authenticated', 'public.jobs', 'lane_env', 'SELECT')::text, 'false');

-- 5. The queued-jobs index (569): partial on status = 'queued', valid.
SELECT pg_temp.assert_eq('the queued-jobs index',
  (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_jobs_lane_queued'),
  'CREATE INDEX idx_jobs_lane_queued ON public.jobs USING btree (lane_env, lane_queued_at) WHERE (status = ''queued''::text)');
SELECT pg_temp.assert_eq('the queued-jobs index is valid',
  (SELECT indisvalid::text FROM pg_index WHERE indexrelid = 'public.idx_jobs_lane_queued'::regclass), 'true');

-- 6. A signed-in user, even reading their own override, gets nothing.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000056801', 'cl-user@cl.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000056804', 'cl-admin@cl.test', '{}', 'authenticated', 'authenticated');
INSERT INTO public.lane_user_overrides (user_id, llm, note, updated_by)
  VALUES ('00000000-0000-4000-8000-000000056801', 9, 'proof', '00000000-0000-4000-8000-000000056804');

-- An override lane is NULL (follows the plan) or 1–500, like a plan size.
DO $$ BEGIN
  UPDATE public.lane_user_overrides SET run = 0 WHERE user_id = '00000000-0000-4000-8000-000000056801';
  RAISE EXCEPTION 'ASSERT FAIL: an override of 0 was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  an override of 0 is refused';
END $$;
DO $$ BEGIN
  UPDATE public.lane_user_overrides SET provider = 501 WHERE user_id = '00000000-0000-4000-8000-000000056801';
  RAISE EXCEPTION 'ASSERT FAIL: an override of 501 was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok  an override of 501 is refused';
END $$;
INSERT INTO public.lane_requeue_payloads (kind, row_id, bull_queue, bull_job_id, name, data, opts)
  VALUES ('job', '00000000-0000-4000-8000-000000056802', 'video', 'j1', 'image-to-video',
          '{"billingPayerId":"00000000-0000-4000-8000-000000056803"}', '{"attempts":1}');
SELECT pg_temp.assert_eq('an override leaves the other lanes unset (NULL = the plan''s size)',
  (SELECT format('%s/%s/%s/%s', coalesce(provider::text, '-'), llm, coalesce(local::text, '-'), coalesce(run::text, '-'))
     FROM public.lane_user_overrides WHERE user_id = '00000000-0000-4000-8000-000000056801'), '-/9/-/-');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000056801","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000056801', true);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lane_plan_sizes', 'lane_user_overrides', 'lane_provider_ceilings', 'lane_requeue_payloads'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t);
      RAISE EXCEPTION 'ASSERT FAIL: a signed-in user read %', t;
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot read %', t;
    END;
  END LOOP;
END $$;
DO $$ BEGIN
  INSERT INTO public.lane_user_overrides (user_id, provider)
    VALUES ('00000000-0000-4000-8000-000000056801', 500)
    ON CONFLICT (user_id) DO UPDATE SET provider = 500;
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user raised their own lane size';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot raise their own lane size';
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.lane_requeue_payloads;
  RAISE EXCEPTION 'ASSERT FAIL: anon read lane_requeue_payloads';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon cannot read lane_requeue_payloads';
END $$;
RESET ROLE;

SELECT pg_temp.assert_eq('the override is unchanged',
  (SELECT coalesce(provider::text, '-') FROM public.lane_user_overrides
    WHERE user_id = '00000000-0000-4000-8000-000000056801'), '-');

-- 7. Deleting the admin who edited an override keeps the override and
--    forgets the editor; deleting the account takes its override with it.
DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000056804';
SELECT pg_temp.assert_eq('a deleted editor leaves the override, updated_by NULL',
  (SELECT format('%s/%s', llm, coalesce(updated_by::text, '-')) FROM public.lane_user_overrides
    WHERE user_id = '00000000-0000-4000-8000-000000056801'), '9/-');

DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000056801';
SELECT pg_temp.assert_eq('a deleted account leaves no override behind',
  (SELECT count(*)::text FROM public.lane_user_overrides
    WHERE user_id = '00000000-0000-4000-8000-000000056801'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
