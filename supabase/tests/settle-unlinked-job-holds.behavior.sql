-- ============================================================================
-- Behavioral proof: migration 515 settles exactly the holds a job was never
-- linked to, at the right amount, and touches nothing else.
--
-- WHY THIS PROOF EXISTS. A one-off data migration that moves credits. These
-- are the ways it could be silently wrong, none of them visible in the SQL text:
--   1. It settles the wrong way: a completed job refunded, a failed or
--      cancelled job committed, or a commit above the reservation (A1-A4, R1-R2).
--   2. A pre-289 refund returns a tenth: the pool split in metadata was never
--      scaled x10 with credits_used, and refund_credits restores the split (R1).
--   3. It settles a row it does not own: a linked hold, a job still running, a
--      managed (job-once) hold, a workspace / external-wallet /
--      deployment-allowance payer, a hold newer than the report, a second hold
--      on an already-charged job, or a refund whose split it cannot trust
--      (S1-S10).
--   4. A second run changes something (I1).
--
-- HOW IT RUNS. Fixtures, then `\ir` of the REAL migration file (never a copy,
-- which would drift), then assertions, then the file again. Rolls back.
-- IF THE MIGRATION IS RENUMBERED, both `\ir` lines must follow it.
--
-- Own uuid range ...-000000515xxx.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/tests/settle-unlinked-job-holds.behavior.sql
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

-- The settlement state of one fixture hold, in one value.
CREATE FUNCTION pg_temp.hold(p_log text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'status', ul.status,
    'charged', ul.credits_charged,
    'from_sub', ul.metadata->'from_sub',
    'from_topup', ul.metadata->'from_topup',
    'reconciled_by', ul.metadata->'reconciled_by',
    'job_link', j.usage_log_id IS NOT DISTINCT FROM ul.id)
  FROM public.usage_logs ul LEFT JOIN public.jobs j ON j.id = ul.job_id
  WHERE ul.id = ('00000000-0000-4000-8000-000000515' || p_log)::uuid
$$;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-000000515a01', 'holds-owner@example.test'),
  ('00000000-0000-4000-8000-000000515a02', 'holds-requester@example.test');
UPDATE public.profiles SET subscription_credits = 1000, topup_credits = 0, daily_spent_credits = 500
 WHERE id = '00000000-0000-4000-8000-000000515a01';

-- One job per case. bNN = job, cNN = its usage log.
INSERT INTO public.jobs(id, user_id, status, credits_actual)
SELECT ('00000000-0000-4000-8000-000000515b' || n)::uuid, '00000000-0000-4000-8000-000000515a01', s, a
FROM (VALUES
  ('01', 'completed', NULL::int),  -- A1 commit, pre-289 split
  ('02', 'completed', 60),         -- A2 commit at the recorded actual
  ('03', 'failed',    NULL),       -- R1 refund, pre-289 split
  ('04', 'cancelled', NULL),       -- R2 refund
  ('05', 'cancelled', NULL),       -- S1 linked hold
  ('06', 'processing', NULL),      -- S2 job still running
  ('07', 'completed', NULL),       -- S3 job-once
  ('08', 'failed',    NULL),       -- S4 workspace payer
  ('09', 'failed',    NULL),       -- S5 newer than the report
  ('10', 'completed', NULL),       -- S6 already charged by another hold
  ('12', 'failed',    NULL),       -- S7 refund, split that matches neither way
  ('13', 'failed',    NULL),       -- S8 refund, no split
  ('14', 'failed',    NULL),       -- S9 external wallet
  ('15', 'failed',    NULL),       -- S10 deployment allowance
  ('16', 'completed', 500),        -- A3 actual above the reservation
  ('17', 'completed', NULL)        -- A4 zero-credit hold
) AS v(n, s, a);

INSERT INTO public.usage_logs(id, user_id, job_id, action, provider, credits_used, status, credits_charged, metadata, created_at, workspace_id, on_behalf_of)
SELECT ('00000000-0000-4000-8000-000000515c' || n)::uuid, '00000000-0000-4000-8000-000000515a01',
       ('00000000-0000-4000-8000-000000515b' || j)::uuid, 'extract-frame', 'test', used, st, charged, meta::jsonb,
       created::timestamptz, ws::uuid, obo::uuid
FROM (VALUES
  ('01', '01', 100, 'reserved',  NULL::int, '{"from_sub":10,"from_topup":0}',          '2026-05-01 00:00+00', NULL, NULL),
  ('02', '02', 100, 'reserved',  NULL,      '{"from_sub":100,"from_topup":0}',         '2026-05-01 00:00+00', NULL, NULL),
  ('03', '03', 100, 'reserved',  NULL,      '{"from_sub":5,"from_topup":5}',           '2026-05-01 00:00+00', NULL, NULL),
  ('04', '04', 30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',          '2026-09-01 00:00+00', NULL, NULL),
  ('05', '05', 30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',          '2026-09-01 00:00+00', NULL, NULL),
  ('06', '06', 30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',          '2026-09-01 00:00+00', NULL, NULL),
  ('07', '07', 30,  'reserved',  NULL,      '{"from_sub":30,"reservation_mode":"job-once"}', '2026-09-01 00:00+00', NULL, NULL),
  ('08', '08', 30,  'reserved',  NULL,      '{}',                                      '2026-09-01 00:00+00', '00000000-0000-4000-8000-000000515d01', NULL),
  ('09', '09', 30,  'reserved',  NULL,      '{"from_sub":30,"from_topup":0}',          '2026-10-14 10:00+00', NULL, NULL),
  ('10', '10', 20,  'reserved',  NULL,      '{"from_sub":20,"from_topup":0}',          '2026-09-01 00:00+00', NULL, NULL),
  ('11', '10', 20,  'committed', 20,        '{"from_sub":20,"from_topup":0}',          '2026-09-01 00:00+00', NULL, NULL),
  ('12', '12', 100, 'reserved',  NULL,      '{"from_sub":33,"from_topup":0}',          '2026-09-01 00:00+00', NULL, NULL),
  ('13', '13', 100, 'reserved',  NULL,      '{}',                                      '2026-09-01 00:00+00', NULL, NULL),
  ('14', '14', 30,  'reserved',  NULL,      '{"from_sub":30,"external_wallet":true}',  '2026-09-01 00:00+00', NULL, NULL),
  ('15', '15', 30,  'reserved',  NULL,      '{"from_sub":30,"payer":{"allowance_enforced":true}}', '2026-09-01 00:00+00', NULL, '00000000-0000-4000-8000-000000515a02'),
  ('16', '16', 50,  'reserved',  NULL,      '{"from_sub":50,"from_topup":0}',          '2026-09-01 00:00+00', NULL, NULL),
  ('17', '17', 0,   'reserved',  NULL,      '{}',                                      '2026-06-01 00:00+00', NULL, NULL)
) AS v(n, j, used, st, charged, meta, created, ws, obo);

UPDATE public.jobs SET usage_log_id = '00000000-0000-4000-8000-000000515c05' WHERE id = '00000000-0000-4000-8000-000000515b05';

-- Every hold the migration must leave exactly as it is, before it runs.
CREATE TEMP TABLE untouched_before AS
SELECT id, status, credits_charged, metadata FROM public.usage_logs
 WHERE id::text ~ '000000515c(05|06|07|08|09|10|11|12|13|14|15)$';

\ir ../migrations/515_settle_unlinked_job_holds.sql

DO $$
BEGIN
  PERFORM pg_temp.assert_eq('A1 completed job, pre-289 hold: committed at reserved, split rescaled x10, link filled',
    pg_temp.hold('c01'),
    '{"status":"committed","charged":100,"from_sub":100,"from_topup":0,"reconciled_by":"515","job_link":true}');
  PERFORM pg_temp.assert_eq('A2 completed job: committed at its recorded actual',
    pg_temp.hold('c02'),
    '{"status":"committed","charged":60,"from_sub":100,"from_topup":0,"reconciled_by":"515","job_link":true}');
  PERFORM pg_temp.assert_eq('A3 an actual above the reservation commits at the reservation',
    pg_temp.hold('c16'),
    '{"status":"committed","charged":50,"from_sub":50,"from_topup":0,"reconciled_by":"515","job_link":true}');
  PERFORM pg_temp.assert_eq('A4 a zero-credit hold commits at 0',
    pg_temp.hold('c17'),
    '{"status":"committed","charged":0,"from_sub":null,"from_topup":null,"reconciled_by":"515","job_link":true}');
  PERFORM pg_temp.assert_eq('R1 failed job, pre-289 hold: refunded, split rescaled x10',
    pg_temp.hold('c03'),
    '{"status":"refunded","charged":null,"from_sub":50,"from_topup":50,"reconciled_by":"515","job_link":true}');
  PERFORM pg_temp.assert_eq('R2 cancelled job: refunded',
    pg_temp.hold('c04'),
    '{"status":"refunded","charged":null,"from_sub":30,"from_topup":0,"reconciled_by":"515","job_link":true}');

  -- The money. The pre-289 refund (R1) returns its FULL 100 credits, not the
  -- 10 its stale split names. A2 gives back the 40 above its actual. R2 returns
  -- 30. Commits at the reserved amount move nothing.
  PERFORM pg_temp.assert_eq('M1 the payer gets back exactly R1 100 + R2 30 + A2 surplus 40',
    (SELECT jsonb_build_object('sub', subscription_credits, 'topup', topup_credits, 'daily', daily_spent_credits)
       FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000515a01'),
    '{"sub":1120,"topup":50,"daily":330}');

  PERFORM pg_temp.assert_eq('S1-S10 every hold out of scope is left exactly as it was',
    (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id) FROM public.usage_logs
      WHERE id::text ~ '000000515c(05|06|07|08|09|10|11|12|13|14|15)$'),
    (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id) FROM untouched_before));
  PERFORM pg_temp.assert_eq('S1-S10 no out-of-scope job gained a link',
    (SELECT to_jsonb(count(*)) FROM public.jobs
      WHERE id::text ~ '000000515b(06|07|08|09|10|12|13|14|15)$' AND usage_log_id IS NOT NULL),
    '0');
END $$;

CREATE TEMP TABLE after_first AS
SELECT (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id)
          FROM public.usage_logs WHERE id::text LIKE '00000000-0000-4000-8000-000000515c%') AS logs,
       (SELECT jsonb_build_array(subscription_credits, topup_credits, daily_spent_credits)
          FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000515a01') AS balance;

\ir ../migrations/515_settle_unlinked_job_holds.sql

DO $$
BEGIN
  PERFORM pg_temp.assert_eq('I1 a second run changes nothing',
    (SELECT jsonb_build_array(
       (SELECT jsonb_agg(jsonb_build_array(id, status, credits_charged, metadata) ORDER BY id)
          FROM public.usage_logs WHERE id::text LIKE '00000000-0000-4000-8000-000000515c%'),
       (SELECT jsonb_build_array(subscription_credits, topup_credits, daily_spent_credits)
          FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000515a01'))),
    (SELECT jsonb_build_array(logs, balance) FROM after_first));
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;

ROLLBACK;
