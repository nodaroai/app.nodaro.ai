-- ============================================================================
-- Behavioral proof: the daily lane history (migration 572).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-0000000572xx).
--
-- The three history tables are written by the server alone and read by the
-- admin page through it. Each assertion below fails if a later migration opens
-- one of them to a client role, drops a default the writer relies on, breaks
-- the upsert keys, or stops a deleted account's history going with it.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/lane-usage-history.behavior.sql mig-test:/tmp/t.sql
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

-- 1. RLS on, one service-role policy, no client privilege.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lane_usage_daily', 'lane_provider_daily', 'lane_history_days'] LOOP
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

-- 2. A row with only its key gets the writer's defaults.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000057201', 'lh-user@lh.test', '{}', 'authenticated', 'authenticated');
INSERT INTO public.lane_usage_daily (day, runtime_env, user_id, payer)
  VALUES ('2026-10-30', 'production', '00000000-0000-4000-8000-000000057201', 'user:00000000-0000-4000-8000-000000057201');
SELECT pg_temp.assert_eq('lane_usage_daily defaults',
  (SELECT format('%s/%s/%s/%s/%s/%s/%s/%s', peak_running, peak_queued, peak_over_limit, longest_wait_ms,
                 minutes_at_limit, queue_timeouts, live_wait_expiries, peak_by_source)
     FROM public.lane_usage_daily WHERE user_id = '00000000-0000-4000-8000-000000057201'),
  '{}/{}/{}/0/0/0/0/{}');
INSERT INTO public.lane_provider_daily (day, runtime_env, provider) VALUES ('2026-10-30', 'production', 'kie');
SELECT pg_temp.assert_eq('lane_provider_daily defaults (no ceiling = NULL)',
  (SELECT format('%s/%s/%s/%s/%s', peak_running, coalesce(ceiling::text, '-'), completed, failed, minutes_at_ceiling)
     FROM public.lane_provider_daily WHERE provider = 'kie'), '0/-/0/0/0');
INSERT INTO public.lane_history_days (day, runtime_env) VALUES ('2026-10-30', 'production');
SELECT pg_temp.assert_eq('lane_history_days defaults',
  (SELECT format('%s/%s', sampled_minutes, enforced_minutes) FROM public.lane_history_days
    WHERE day = '2026-10-30' AND runtime_env = 'production'), '0/0');

-- 3. The upsert keys: the same (day, environment, user, payer) is one row, and
--    another environment's row of the same day stands beside it.
INSERT INTO public.lane_usage_daily (day, runtime_env, user_id, payer, minutes_at_limit)
  VALUES ('2026-10-30', 'production', '00000000-0000-4000-8000-000000057201', 'user:00000000-0000-4000-8000-000000057201', 7)
  ON CONFLICT (day, runtime_env, user_id, payer) DO UPDATE SET minutes_at_limit = EXCLUDED.minutes_at_limit;
INSERT INTO public.lane_usage_daily (day, runtime_env, user_id, payer, minutes_at_limit)
  VALUES ('2026-10-30', 'staging', '00000000-0000-4000-8000-000000057201', 'user:00000000-0000-4000-8000-000000057201', 2)
  ON CONFLICT (day, runtime_env, user_id, payer) DO UPDATE SET minutes_at_limit = EXCLUDED.minutes_at_limit;
SELECT pg_temp.assert_eq('one row per environment, the upsert overwrote',
  (SELECT string_agg(runtime_env || '=' || minutes_at_limit, ' ' ORDER BY runtime_env) FROM public.lane_usage_daily
    WHERE user_id = '00000000-0000-4000-8000-000000057201'), 'production=7 staging=2');
INSERT INTO public.lane_provider_daily (day, runtime_env, provider, completed)
  VALUES ('2026-10-30', 'production', 'kie', 12)
  ON CONFLICT (day, runtime_env, provider) DO UPDATE SET completed = EXCLUDED.completed;
SELECT pg_temp.assert_eq('the provider upsert overwrote',
  (SELECT completed::text FROM public.lane_provider_daily WHERE provider = 'kie'), '12');

-- 4. A history row for an account that does not exist is refused.
DO $$ BEGIN
  INSERT INTO public.lane_usage_daily (day, runtime_env, user_id, payer)
    VALUES ('2026-10-30', 'production', '00000000-0000-4000-8000-000000057299', 'user:x');
  RAISE EXCEPTION 'ASSERT FAIL: a row for an unknown account was accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok  a row for an unknown account is refused';
END $$;

-- 5. A signed-in user, even the one the row is about, reads nothing.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000057201","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000057201', true);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lane_usage_daily', 'lane_provider_daily', 'lane_history_days'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t);
      RAISE EXCEPTION 'ASSERT FAIL: a signed-in user read %', t;
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot read %', t;
    END;
  END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.lane_usage_daily;
  RAISE EXCEPTION 'ASSERT FAIL: anon read lane_usage_daily';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon cannot read lane_usage_daily';
END $$;
RESET ROLE;

-- 6. The drill-down index.
SELECT pg_temp.assert_eq('the per-user index',
  (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_lane_usage_daily_user'),
  'CREATE INDEX idx_lane_usage_daily_user ON public.lane_usage_daily USING btree (user_id, day)');

-- 7. Deleting the account takes its history with it.
DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000057201';
SELECT pg_temp.assert_eq('a deleted account leaves no history behind',
  (SELECT count(*)::text FROM public.lane_usage_daily WHERE user_id = '00000000-0000-4000-8000-000000057201'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
