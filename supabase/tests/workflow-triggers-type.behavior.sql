-- ============================================================================
-- Behavioral proof: workflow_triggers.type admits every lane the backend
-- writes (migration 438).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000c21 upward).
--
-- The claim: a Telegram Trigger row can be written. Migration 036 pinned the
-- column to ('webhook','schedule'); two lanes wrote 'telegram' for months and
-- every INSERT was a check_violation the mocked unit tests could not see. 438
-- widens the CHECK. This proof also shows the CHECK is still a CHECK — an
-- unknown type is refused — so widening did not quietly become "anything".
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker exec -i mig-test psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/workflow-triggers-type.behavior.sql
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
  ('00000000-0000-4000-8000-000000000c21', 'tt-owner@tt.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'tt project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000000c21', 'c0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'tt wf');

-- 0. Shape: exactly one CHECK on the column, and it names all three lanes.
SELECT pg_temp.assert_eq('one CHECK constraint named workflow_triggers_type_check',
  (SELECT count(*)::text FROM pg_constraint
    WHERE conrelid = 'public.workflow_triggers'::regclass AND conname = 'workflow_triggers_type_check' AND contype = 'c'),
  '1');
SELECT pg_temp.assert_eq('the CHECK admits webhook, schedule and telegram',
  (SELECT (def LIKE '%''webhook''%' AND def LIKE '%''schedule''%' AND def LIKE '%''telegram''%')::text
     FROM (SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'public.workflow_triggers'::regclass AND conname = 'workflow_triggers_type_check') d),
  'true');

-- 1. The backend (service role; `postgres` here) can write every lane it has.
INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config) VALUES
  ('e0000000-0000-4000-8000-000000000c21', 'd0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'webhook',  '{}'),
  ('e0000000-0000-4000-8000-000000000c22', 'd0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'schedule', '{"rules":[]}'),
  ('e0000000-0000-4000-8000-000000000c23', 'd0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'telegram', '{"connectionId":"11111111-1111-4111-8111-111111111111","secretToken":"shh","nodeId":"tg1"}');
SELECT pg_temp.assert_eq('a telegram trigger row exists after insert',
  (SELECT type FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000c23'), 'telegram');

-- 1b. The role the backend really runs as can write it too.
SET LOCAL ROLE service_role;
INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config) VALUES
  ('e0000000-0000-4000-8000-000000000c24', 'd0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'telegram', '{"nodeId":"tg2"}');
SELECT pg_temp.assert_eq('service_role — the backend — can write telegram',
  (SELECT type FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000c24'), 'telegram');
RESET ROLE;

-- 1c. The account lane (migration 441): a trigger row, and the execution a fire
--     inserts — BOTH checks were widened together.
INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config) VALUES
  ('e0000000-0000-4000-8000-000000000c26', 'd0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'telegram_account', '{"accountId":"22222222-2222-4222-8222-222222222222","nodeId":"tga1"}');
SELECT pg_temp.assert_eq('a telegram_account trigger row exists after insert',
  (SELECT type FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000c26'), 'telegram_account');
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type) VALUES
  ('f0000000-0000-4000-8000-000000000c26', 'd0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'pending', 'telegram_account');
SELECT pg_temp.assert_eq('an execution can carry trigger_type telegram_account',
  (SELECT trigger_type FROM workflow_executions WHERE id = 'f0000000-0000-4000-8000-000000000c26'), 'telegram_account');
-- 2. Still a CHECK: a lane nobody declared is refused, not silently stored.
DO $$
BEGIN
  INSERT INTO workflow_triggers (id, workflow_id, user_id, type, config) VALUES
    ('e0000000-0000-4000-8000-000000000c25', 'd0000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c21', 'carrier-pigeon', '{}');
  RAISE EXCEPTION 'ASSERT FAIL [an undeclared type is refused]: the INSERT succeeded';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  an undeclared type is refused (check_violation)';
END $$;
SELECT pg_temp.assert_eq('the refused row was not written',
  (SELECT count(*)::text FROM workflow_triggers WHERE id = 'e0000000-0000-4000-8000-000000000c25'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
