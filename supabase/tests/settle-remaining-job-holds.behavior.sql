-- ============================================================================
-- Behavioral proof: migration 516 settles the linked holds on finished jobs and
-- the pre-August job-less holds, at the right amount, leaves today's daily
-- counter alone, and touches nothing else.
--
-- What could be silently wrong, none of it visible in the SQL text:
--   1. The wrong direction or amount: a completed job refunded, a failed job
--      committed, a commit above the reservation (L1-L4).
--   2. A pre-289 refund returns a tenth of the hold, because the split was never
--      scaled x10 (L3, J1).
--   3. The RPCs subtract months-old holds from TODAY's daily counter (M1).
--   4. It settles a row it does not own: an unlinked, young, job-once,
--      workspace, external-wallet or allowance hold; an already-charged job; an
--      untrusted split; a pipeline that is running or spent something; a
--      job-less hold reserved since August (S1-S11).
--   5. A pipeline is left able to resume without its hold (J1, J2).
--   6. A second run changes something (I1).
--
-- HOW IT RUNS. Fixtures, then `\ir` of the REAL migration file, assertions, the
-- file again. Rolls back. Own uuid range ...-000000516xxx.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/settle-remaining-job-holds.behavior.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual jsonb, expected jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual::text, '<null>'), coalesce(expected::text, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

CREATE FUNCTION pg_temp.hold(p_log text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('status', status, 'charged', credits_charged,
    'from_sub', metadata->'from_sub', 'from_topup', metadata->'from_topup', 'reconciled_by', metadata->'reconciled_by')
  FROM public.usage_logs WHERE id = ('00000000-0000-4000-8000-000000516' || p_log)::uuid
$$;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-000000516a01', 'holds516-owner@example.test'),
  ('00000000-0000-4000-8000-000000516a02', 'holds516-requester@example.test');
UPDATE public.profiles SET subscription_credits = 1000, topup_credits = 0, daily_spent_credits = 500
 WHERE id = '00000000-0000-4000-8000-000000516a01';

-- bNN = job, cNN = usage log, pNN = pipeline.
INSERT INTO public.jobs(id, user_id, status, credits_actual, completed_at)
SELECT ('00000000-0000-4000-8000-000000516b' || n)::uuid, '00000000-0000-4000-8000-000000516a01', s, a, ca::timestamptz
FROM (VALUES
  ('01', 'completed', NULL::int, '2026-09-01 00:00+00'),  -- L1 linked completed: commit at reserved
  ('02', 'completed', 60,        '2026-09-01 00:00+00'),  -- L2 linked completed: commit at actual
  ('03', 'cancelled', NULL,      '2026-03-01 00:00+00'),  -- L3 linked cancelled, pre-289: full refund
  ('04', 'failed',    NULL,      '2026-09-01 00:00+00'),  -- L4 linked failed: refund
  ('05', 'failed',    NULL,      '2026-09-01 00:00+00'),  -- S1 unlinked (515's class)
  ('06', 'completed', NULL,      NULL),                   -- S2 hold younger than 24h
  ('07', 'completed', NULL,      NULL),                   -- S3 job-once
  ('08', 'failed',    NULL,      '2026-09-01 00:00+00'),  -- S4 workspace payer
  ('09', 'failed',    NULL,      '2026-09-01 00:00+00'),  -- S5 external wallet
  ('10', 'failed',    NULL,      '2026-09-01 00:00+00'),  -- S6 deployment allowance
  ('11', 'completed', NULL,      '2026-09-01 00:00+00'),  -- S7 already charged by another log
  ('12', 'failed',    NULL,      '2026-09-01 00:00+00'),  -- S8 untrusted split
  ('13', 'processing', NULL,     NULL),                   -- S9 job still live
  ('14', 'completed', NULL,      now()::text)             -- S10 finished less than an hour ago
) AS v(n, s, a, ca);

INSERT INTO public.usage_logs(id, user_id, job_id, action, provider, credits_used, status, credits_charged, metadata, created_at, workspace_id, on_behalf_of)
SELECT ('00000000-0000-4000-8000-000000516c' || n)::uuid, '00000000-0000-4000-8000-000000516a01',
       CASE WHEN j IS NULL THEN NULL ELSE ('00000000-0000-4000-8000-000000516b' || j)::uuid END,
       act, 'test', used, st, charged, meta::jsonb, created::timestamptz, ws::uuid, obo::uuid
FROM (VALUES
  ('01', '01', 'social-publish', 10,  'reserved',  NULL::int, '{"from_sub":10,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  ('02', '02', 'generate-image', 100, 'reserved',  NULL,      '{"from_sub":100,"from_topup":0}',           '2026-09-01 00:00+00', NULL, NULL),
  ('03', '03', 'lip-sync',       100, 'reserved',  NULL,      '{"from_sub":5,"from_topup":5}',             '2026-03-01 00:00+00', NULL, NULL),
  ('04', '04', 'voice-changer',  20,  'reserved',  NULL,      '{"from_sub":20,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  ('05', '05', 'extract-frame',  30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  ('06', '06', 'social-publish', 30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',            now()::text,           NULL, NULL),
  ('07', '07', 'render',         30,  'reserved',  NULL,      '{"from_sub":30,"reservation_mode":"job-once"}', '2026-09-01 00:00+00', NULL, NULL),
  ('08', '08', 'render',         30,  'reserved',  NULL,      '{}',                                        '2026-09-01 00:00+00', '00000000-0000-4000-8000-000000516d01', NULL),
  ('09', '09', 'render',         30,  'reserved',  NULL,      '{"from_sub":30,"external_wallet":true}',    '2026-09-01 00:00+00', NULL, NULL),
  ('10', '10', 'render',         30,  'reserved',  NULL,      '{"from_sub":30,"payer":{"allowance_enforced":true}}', '2026-09-01 00:00+00', NULL, '00000000-0000-4000-8000-000000516a02'),
  ('11', '11', 'render',         20,  'reserved',  NULL,      '{"from_sub":20,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  ('12', '11', 'render',         20,  'committed', 20,        '{"from_sub":20,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  ('13', '12', 'render',         100, 'reserved',  NULL,      '{"from_sub":33,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  ('14', '13', 'render',         30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  ('15', '14', 'render',         30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',            '2026-09-01 00:00+00', NULL, NULL),
  -- Job-less holds.
  ('21', NULL, 'pipeline-orchestration', 400, 'reserved', NULL, '{"from_sub":0,"from_topup":40}',          '2026-05-20 00:00+00', NULL, NULL), -- J1 queued pipeline, spent 0
  ('22', NULL, 'pipeline-orchestration', 400, 'reserved', NULL, '{"from_sub":0,"from_topup":40}',          '2026-05-20 00:00+00', NULL, NULL), -- J2 completed pipeline, spent 0
  ('23', NULL, 'social-publish',         10,  'reserved', NULL, '{"from_sub":1,"from_topup":0,"allowance_delta":1}', '2026-07-20 00:00+00', NULL, NULL), -- J3 deleted job
  ('24', NULL, 'pipeline-orchestration', 400, 'reserved', NULL, '{"from_sub":0,"from_topup":40}',          '2026-05-20 00:00+00', NULL, NULL), -- S11a running pipeline
  ('25', NULL, 'pipeline-orchestration', 400, 'reserved', NULL, '{"from_sub":0,"from_topup":40}',          '2026-05-20 00:00+00', NULL, NULL), -- S11b pipeline spent something
  ('26', NULL, 'pipeline-orchestration', 400, 'reserved', NULL, '{"from_sub":400,"from_topup":0}',         '2026-09-20 00:00+00', NULL, NULL)  -- S11c reserved since August
) AS v(n, j, act, used, st, charged, meta, created, ws, obo);

UPDATE public.jobs j SET usage_log_id = ('00000000-0000-4000-8000-000000516c' || right(j.id::text, 2))::uuid
 WHERE j.id::text ~ '000000516b(01|02|03|04|06|07|08|09|10|11|12|13|14)$';
UPDATE public.jobs SET usage_log_id = NULL WHERE id = '00000000-0000-4000-8000-000000516b05';
-- S7: job b11 points at its reserved log c11 (c12 is the already-committed sibling).
UPDATE public.jobs SET usage_log_id = '00000000-0000-4000-8000-000000516c11' WHERE id = '00000000-0000-4000-8000-000000516b11';
UPDATE public.jobs SET usage_log_id = '00000000-0000-4000-8000-000000516c13' WHERE id = '00000000-0000-4000-8000-000000516b12';
UPDATE public.jobs SET usage_log_id = '00000000-0000-4000-8000-000000516c14' WHERE id = '00000000-0000-4000-8000-000000516b13';
UPDATE public.jobs SET usage_log_id = '00000000-0000-4000-8000-000000516c15' WHERE id = '00000000-0000-4000-8000-000000516b14';

INSERT INTO public.pipelines(id, user_id, root_node_id, pipeline_type, activation_mode, mode, status, input_prompt,
                             target_duration_seconds, format, reserved_credits, spent_credits, reservation_usage_log_id)
SELECT ('00000000-0000-4000-8000-000000516e' || n)::uuid, '00000000-0000-4000-8000-000000516a01', 'root',
       'story_to_video', 'interactive', 'manual', s, 'p', 30, 'trailer', 40, spent,
       ('00000000-0000-4000-8000-000000516c' || c)::uuid
FROM (VALUES
  ('01', 'queued',    0, '21'),
  ('02', 'completed', 0, '22'),
  ('04', 'running',   0, '24'),
  ('05', 'failed',    7, '25'),
  ('06', 'awaiting_approval', 0, '26')
) AS v(n, s, spent, c);

CREATE TEMP TABLE untouched_before AS
SELECT id, status, credits_charged, metadata FROM public.usage_logs
 WHERE id::text ~ '000000516c(05|06|07|08|09|10|11|12|13|14|15|24|25|26)$';

\ir ../migrations/516_settle_remaining_job_holds.sql

DO $$
BEGIN
  PERFORM pg_temp.assert_eq('L1 linked completed: committed at reserved',
    pg_temp.hold('c01'), '{"status":"committed","charged":10,"from_sub":10,"from_topup":0,"reconciled_by":"516"}');
  PERFORM pg_temp.assert_eq('L2 linked completed: committed at its recorded actual',
    pg_temp.hold('c02'), '{"status":"committed","charged":60,"from_sub":100,"from_topup":0,"reconciled_by":"516"}');
  PERFORM pg_temp.assert_eq('L3 linked cancelled, pre-289: refunded with the split rescaled x10',
    pg_temp.hold('c03'), '{"status":"refunded","charged":null,"from_sub":50,"from_topup":50,"reconciled_by":"516"}');
  PERFORM pg_temp.assert_eq('L4 linked failed: refunded',
    pg_temp.hold('c04'), '{"status":"refunded","charged":null,"from_sub":20,"from_topup":0,"reconciled_by":"516"}');
  PERFORM pg_temp.assert_eq('J1 queued pipeline that spent nothing: refunded x10, pipeline abandoned to failed, pointer cleared',
    (SELECT pg_temp.hold('c21') || jsonb_build_object('pipeline', to_jsonb(p.status), 'reason', to_jsonb(p.failure_reason),
            'pointer', to_jsonb(p.reservation_usage_log_id)) FROM public.pipelines p WHERE p.id = '00000000-0000-4000-8000-000000516e01'),
    '{"status":"refunded","charged":null,"from_sub":0,"from_topup":400,"reconciled_by":"516","pipeline":"failed","reason":"stale_hold_refunded_516","pointer":null}');
  PERFORM pg_temp.assert_eq('J2 completed pipeline that spent nothing: refunded, stays completed, pointer cleared',
    (SELECT pg_temp.hold('c22') || jsonb_build_object('pipeline', to_jsonb(p.status), 'pointer', to_jsonb(p.reservation_usage_log_id))
       FROM public.pipelines p WHERE p.id = '00000000-0000-4000-8000-000000516e02'),
    '{"status":"refunded","charged":null,"from_sub":0,"from_topup":400,"reconciled_by":"516","pipeline":"completed","pointer":null}');
  PERFORM pg_temp.assert_eq('J3 pre-August hold whose job was deleted: refunded x10',
    pg_temp.hold('c23'), '{"status":"refunded","charged":null,"from_sub":10,"from_topup":0,"reconciled_by":"516"}');

  -- Money: refunds L3 100 (50 sub + 50 topup), L4 20 sub, J1 400 topup, J2 400 topup, J3 10 sub;
  -- L2 gives back the 40 above its actual to sub. The daily counter stays 500.
  PERFORM pg_temp.assert_eq('M1 exact balances, and today''s daily counter is untouched',
    (SELECT jsonb_build_object('sub', subscription_credits, 'topup', topup_credits, 'daily', daily_spent_credits)
       FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000516a01'),
    '{"sub":1120,"topup":850,"daily":500}');

  PERFORM pg_temp.assert_eq('S1-S11 every hold out of scope is left exactly as it was',
    (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id) FROM public.usage_logs
      WHERE id::text ~ '000000516c(05|06|07|08|09|10|11|12|13|14|15|24|25|26)$'),
    (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id) FROM untouched_before));
  PERFORM pg_temp.assert_eq('S11 out-of-scope pipelines keep their status and pointer',
    (SELECT jsonb_agg(jsonb_build_array(status, reservation_usage_log_id IS NOT NULL) ORDER BY id) FROM public.pipelines
      WHERE id::text ~ '000000516e(04|05|06)$'),
    '[["running",true],["failed",true],["awaiting_approval",true]]');
END $$;

CREATE TEMP TABLE after_first AS
SELECT (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id)
          FROM public.usage_logs WHERE id::text LIKE '00000000-0000-4000-8000-000000516c%') AS logs,
       (SELECT jsonb_build_array(subscription_credits, topup_credits, daily_spent_credits)
          FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000516a01') AS balance;

\ir ../migrations/516_settle_remaining_job_holds.sql

DO $$
BEGIN
  PERFORM pg_temp.assert_eq('I1 a second run changes nothing',
    (SELECT jsonb_build_array(
       (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id)
          FROM public.usage_logs WHERE id::text LIKE '00000000-0000-4000-8000-000000516c%'),
       (SELECT jsonb_build_array(subscription_credits, topup_credits, daily_spent_credits)
          FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000516a01'))),
    (SELECT jsonb_build_array(logs, balance) FROM after_first));
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;

ROLLBACK;
