-- ============================================================================
-- Behavioral proof: migration 509 (inline use-case executions).
-- Runs after the whole chain, as postgres, in a transaction that rolls back.
-- Run locally: see supabase/tests/workflow-triggers-type.behavior.sql header.
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
  ('00000000-0000-4000-8000-000000000d51', 'uc-owner@uc.test', '{}', 'authenticated', 'authenticated');
INSERT INTO jobs (id, user_id, status, provider, input_data) VALUES
  ('a0000000-0000-4000-8000-000000000d51', '00000000-0000-4000-8000-000000000d51', 'processing', 'use-case', '{"type":"tighten-episode"}');

-- 1. An inline row: no workflow, a graph, a wrapper, the use_case lane.
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, inline_graph, wrapper_job_id) VALUES
  ('f0000000-0000-4000-8000-000000000d51', NULL, '00000000-0000-4000-8000-000000000d51', 'pending', 'use_case',
   '{"version":1,"nodeType":"tighten-episode","nodes":[],"edges":[],"hash":"0123456789abcdef"}',
   'a0000000-0000-4000-8000-000000000d51');
SELECT pg_temp.assert_eq('an inline execution is stored with trigger_type use_case',
  (SELECT trigger_type FROM workflow_executions WHERE id = 'f0000000-0000-4000-8000-000000000d51'), 'use_case');

-- 1b. As the role the backend runs as.
SET LOCAL ROLE service_role;
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, inline_graph) VALUES
  ('f0000000-0000-4000-8000-000000000d52', NULL, '00000000-0000-4000-8000-000000000d51', 'pending', 'use_case', '{"version":1}');
SELECT pg_temp.assert_eq('service_role can write an inline execution',
  (SELECT count(*)::text FROM workflow_executions WHERE id = 'f0000000-0000-4000-8000-000000000d52'), '1');
RESET ROLE;

-- 2. Neither a workflow nor a graph: refused.
DO $$
BEGIN
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type) VALUES
    ('f0000000-0000-4000-8000-000000000d53', NULL, '00000000-0000-4000-8000-000000000d51', 'pending', 'use_case');
  RAISE EXCEPTION 'ASSERT FAIL [graph-source CHECK]: a row with no workflow and no graph was stored';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  a row with no workflow and no graph is a check_violation';
END $$;

-- 3. The snapshot is an object.
DO $$
BEGIN
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, inline_graph) VALUES
    ('f0000000-0000-4000-8000-000000000d54', NULL, '00000000-0000-4000-8000-000000000d51', 'pending', 'use_case', '[]');
  RAISE EXCEPTION 'ASSERT FAIL [inline_graph object CHECK]: an array snapshot was stored';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  a non-object snapshot is a check_violation';
END $$;

-- 4. Deleting the wrapper nulls the pointer; the execution stays.
DELETE FROM jobs WHERE id = 'a0000000-0000-4000-8000-000000000d51';
SELECT pg_temp.assert_eq('wrapper_job_id is set NULL when its job is deleted',
  (SELECT coalesce(wrapper_job_id::text, 'null') FROM workflow_executions WHERE id = 'f0000000-0000-4000-8000-000000000d51'), 'null');

-- 5. Still a CHECK on the lane.
DO $$
BEGIN
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, inline_graph) VALUES
    ('f0000000-0000-4000-8000-000000000d55', NULL, '00000000-0000-4000-8000-000000000d51', 'pending', 'carrier-pigeon', '{}');
  RAISE EXCEPTION 'ASSERT FAIL [trigger_type CHECK]: an unknown lane was stored';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  an unknown trigger lane is still refused';
END $$;

-- 6. The fee row.
SELECT pg_temp.assert_eq('the Tighten Episode fee is 10 credits',
  (SELECT credit_cost::text FROM model_pricing WHERE model_identifier = 'use-case-fee:tighten-episode'), '10');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
