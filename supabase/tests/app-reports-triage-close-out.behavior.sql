-- ============================================================================
-- Behavioral proof: migration 370 closes exactly the 114 decidable app-report
-- rows of the 2026-09-01 triage — and nothing else.
--
-- WHY THIS PROOF EXISTS. This is a DATA migration whose predicates are strings
-- and uuid lists, run once against production. Two ways it can be silently
-- wrong, neither visible in the SQL text:
--   1. It closes rows created AFTER the export. The failure sweep writes rows
--      with byte-identical error text every hour, so "status='new' AND kind=…"
--      alone would also close untriaged rows — including a REGRESSION of one of
--      the defects this migration calls fixed. Assertion N1 is that guard.
--   2. A predicate is too broad and eats a row that belongs to another lane.
--      Assertions N4/N5 pin the two closest neighbours: P8's three
--      "imageUrl is required" rows share kind + route with D-P10C, and the 96
--      Suno price-not-configured rows are the script lane's largest cluster.
--
-- HOW IT RUNS. Fixtures, then `\ir` of the REAL migration file (never a copy —
-- a copy drifts), then counts. Rolls back. One fixture row per rule: 9
-- resolved + 21 dismissed + 5 near-misses = 35.
--
-- `\ir`, NOT `\i`: \ir resolves relative to THIS file's directory, so the proof
-- runs from any cwd. `\i` would resolve against the caller's cwd, which happens
-- to be the repo root in CI today and would break silently the day that changes.
--
-- IF THE MIGRATION IS RENUMBERED on a merge collision, both `\ir` lines below
-- must be renumbered with it. A stale path fails loudly (ON_ERROR_STOP plus the
-- CI step's ERROR grep), never silently.
--
-- Own uuid range ...-000000000941 upward (jobs rows deliberately reuse the real
-- production job ids the migration names, which are outside every fixture range).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase mig-test:/repo/supabase          # the proof \ir's a sibling file, so copy the tree
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /repo/supabase/tests/app-reports-triage-close-out.behavior.sql
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
  ('00000000-0000-4000-8000-000000000941', 'ar-owner@ar.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'ar project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000000941', 'c0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'ar wf');

INSERT INTO jobs (id, workflow_id, user_id, status) VALUES
  ('46981f1b-34df-4f2c-9150-8bf0a536243e', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- R-B1
  ('31304a6f-bd64-4468-bc8e-ce4140113631', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- R-B9
  ('47fffad7-798f-4744-af02-b73bacb27573', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- R-B12
  ('1dbf5be0-4f2d-48a5-92b6-32e429cc317e', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- R-S1STALE
  ('7996c7d4-dbbf-475c-8767-88e6f1a0fc4e', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- R-B2STILL
  ('33b45bd9-890e-4836-ba16-9b18a469b5f2', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- R-H1ADD
  ('19c55b68-8c9f-4281-8e96-67ce9e8da42c', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-U4
  ('4a784972-c010-4185-838c-88d07b0c3b79', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-U5
  ('0ceea54d-e28c-4d6f-8032-f06ea2b0fec0', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-U7
  ('1d830e59-3c55-4b03-b441-329c1a98ce9d', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-U8
  ('0ac6d041-c021-438c-bca8-dbee4eb46e5c', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-G2
  ('6214bd8d-039c-4ca4-b66a-2939ae4dd9e0', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-H1DIS
  ('3e105ffa-e856-4ac2-ad66-2ac236d79bce', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-B7RESCORE
  ('1c4be8ef-b6f9-46bc-954f-c4b2715435f6', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-B11
  ('099a2b87-6caf-4661-a1bb-d93881a6ba4c', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-P1GVP
  ('3a7e470e-3e53-4d9b-8afd-a62c788431b2', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed'),  -- D-P6PREV
  ('00142a7c-1122-4c60-86ea-7667628d8d84', 'd0000000-0000-4000-8000-000000000941', '00000000-0000-4000-8000-000000000941', 'failed');  -- D-S2

INSERT INTO app_reports (node, kind, title, payload, job_id, status, created_at) VALUES
  ('app-reports-close-out-proof', 'job-failure', 'R-B1', '{}'::jsonb, '46981f1b-34df-4f2c-9150-8bf0a536243e', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'R-B9', '{}'::jsonb, '31304a6f-bd64-4468-bc8e-ce4140113631', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'R-B10', '{"error":"WARNING: [youtube] No supported JavaScript runtime could be found."}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'R-B12', '{}'::jsonb, '47fffad7-798f-4744-af02-b73bacb27573', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'validation-reject', 'R-P7T2V', '{"route":"/v1/text-to-video","method":"POST","message":"userPrompt: Too big"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'R-S1STALE', '{}'::jsonb, '1dbf5be0-4f2d-48a5-92b6-32e429cc317e', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'R-B2STILL', '{}'::jsonb, '7996c7d4-dbbf-475c-8767-88e6f1a0fc4e', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'internal-error', 'R-B7DUP', '{"route":"/v1/recast/:id/duplicate","method":"POST","message":"The specified key does not exist."}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'R-H1ADD', '{}'::jsonb, '33b45bd9-890e-4836-ba16-9b18a469b5f2', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'insufficient-credits', 'D-U1', '{"route":"/v1/generate-video","method":"POST","message":"Insufficient credits. Required: 308, Available: 283"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'execution-failure', 'D-U2', '{"error":"Node execution failed: node_3: Credit reservation failed for generate-image"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-U4', '{}'::jsonb, '19c55b68-8c9f-4281-8e96-67ce9e8da42c', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-U5', '{}'::jsonb, '4a784972-c010-4185-838c-88d07b0c3b79', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'validation-reject', 'D-U6', '{"route":"/v1/image-proxy","method":"GET","message":"Missing or invalid ''url'' query parameter"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-U7', '{}'::jsonb, '0ceea54d-e28c-4d6f-8032-f06ea2b0fec0', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-U8', '{}'::jsonb, '1d830e59-3c55-4b03-b441-329c1a98ce9d', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-G2', '{}'::jsonb, '0ac6d041-c021-438c-bca8-dbee4eb46e5c', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'validation-reject', 'D-P9', '{"route":"/v1/voice-changer-pro","method":"POST","message":"orderedVoices: a speaker set to Re-speak has no transcript"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'validation-reject', 'D-P10A', '{"route":"/v1/app/:slug/runs/:runId","method":"PATCH","message":"Invalid parameters"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'validation-reject', 'D-P10B', '{"route":"/v1/voice-changer-pro","method":"POST","message":"videoUrl: Invalid URL (+1 more)"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'validation-reject', 'D-P10C', '{"route":"/v1/generate-video","method":"POST","message":"imageUrl: URL must use http(s) and must not point to localhost or private networks"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-H1DIS', '{}'::jsonb, '6214bd8d-039c-4ca4-b66a-2939ae4dd9e0', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'internal-error', 'D-B4', '{"route":"/v1/voice-changer-pro","method":"POST","message":"insert or update on table \"jobs\" violates foreign key constraint \"jobs_workflow_id_fkey\""}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-B7RESCORE', '{}'::jsonb, '3e105ffa-e856-4ac2-ad66-2ac236d79bce', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-B7FORK', '{"error":"This recast''s media is no longer available, so it can''t be duplicated."}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'internal-error', 'D-B7WF', '{"route":"/v1/workflows/:id","method":"GET","message":"Failed to fetch workflow"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-B11', '{}'::jsonb, '1c4be8ef-b6f9-46bc-954f-c4b2715435f6', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-P1GVP', '{}'::jsonb, '099a2b87-6caf-4661-a1bb-d93881a6ba4c', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-P6PREV', '{}'::jsonb, '3a7e470e-3e53-4d9b-8afd-a62c788431b2', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'D-S2', '{}'::jsonb, '00142a7c-1122-4c60-86ea-7667628d8d84', 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'insufficient-credits', 'N1 out-of-bound', '{}'::jsonb, NULL, 'new', '2026-09-01T13:00:00Z'),
  ('app-reports-close-out-proof', 'insufficient-credits', 'N2 already reviewed', '{}'::jsonb, NULL, 'reviewed', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'job-failure', 'N3 G1 generic', '{"error":"Generation failed. Please try again or contact support if the issue persists."}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'validation-reject', 'N4 P8 imageUrl required', '{"route":"/v1/generate-video","method":"POST","message":"imageUrl is required"}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z'),
  ('app-reports-close-out-proof', 'price-not-configured', 'N5 C1 suno pricing', '{"route":"/v1/credits/model-cost","method":"GET","message":"Pricing is not configured for \"V5\"."}'::jsonb, NULL, 'new', '2026-08-20T00:00:00Z');

-- 0. Not vacuous: 35 fixture rows exist, 34 of them 'new'.
SELECT pg_temp.assert_eq('35 fixture rows seeded',
  (SELECT count(*)::text FROM app_reports WHERE node = 'app-reports-close-out-proof'), '35');
SELECT pg_temp.assert_eq('34 of them start as new',
  (SELECT count(*)::text FROM app_reports WHERE node = 'app-reports-close-out-proof' AND status = 'new'), '34');

-- Apply the REAL migration file (not a copy — a copy would drift from it).
\ir ../migrations/370_app_reports_triage_close_out.sql

-- The NAMED guards come first, before the aggregate counts. ON_ERROR_STOP means
-- the first failing assertion is the one you read, and a specific label
-- ("a post-export row stays new") diagnoses the bug; "got 22 expected 21" does
-- not.

-- 1. THE created_at BOUND. An identical row created after the export instant is
--    untouched — this is what stops a regression of a "fixed" defect from being
--    auto-resolved.
SELECT pg_temp.assert_eq('N1: a post-export row with the same predicate stays new',
  (SELECT status FROM app_reports WHERE node = 'app-reports-close-out-proof' AND title = 'N1 out-of-bound'), 'new');

-- 2. Only status='new' is rewritten; an already-triaged row keeps its status.
SELECT pg_temp.assert_eq('N2: an already-reviewed row is not rewritten',
  (SELECT status FROM app_reports WHERE node = 'app-reports-close-out-proof' AND title = 'N2 already reviewed'), 'reviewed');

-- 3. The three lanes this migration must NOT touch.
SELECT pg_temp.assert_eq('N3: a G1 generic "Generation failed" row stays new (W0 data lane)',
  (SELECT status FROM app_reports WHERE node = 'app-reports-close-out-proof' AND title = 'N3 G1 generic'), 'new');
SELECT pg_temp.assert_eq('N4: P8 "imageUrl is required" stays new — D-P10C shares its kind AND route',
  (SELECT status FROM app_reports WHERE node = 'app-reports-close-out-proof' AND title = 'N4 P8 imageUrl required'), 'new');
SELECT pg_temp.assert_eq('N5: a Suno price-not-configured row stays new (script lane)',
  (SELECT status FROM app_reports WHERE node = 'app-reports-close-out-proof' AND title = 'N5 C1 suno pricing'), 'new');

-- 4. Every rule is covered: no fixture row named after a rule is still 'new'.
SELECT pg_temp.assert_eq('no rule fixture was left behind',
  (SELECT coalesce(string_agg(title, ',' ORDER BY title), '<none>') FROM app_reports
    WHERE node = 'app-reports-close-out-proof' AND status = 'new' AND title NOT LIKE 'N% %'), '<none>');

-- 5. The aggregate: every rule fired exactly once, and nothing else moved.
SELECT pg_temp.assert_eq('9 fixture rows became resolved (one per resolved rule)',
  (SELECT count(*)::text FROM app_reports WHERE node = 'app-reports-close-out-proof' AND status = 'resolved'), '9');
SELECT pg_temp.assert_eq('21 fixture rows became dismissed (one per dismissed rule)',
  (SELECT count(*)::text FROM app_reports WHERE node = 'app-reports-close-out-proof' AND status = 'dismissed'), '21');

-- 6. Idempotent: a second apply changes nothing (the CI job re-applies the
--    newest migration, and a re-run must not walk rows forward again).
\ir ../migrations/370_app_reports_triage_close_out.sql
SELECT pg_temp.assert_eq('re-apply is a no-op: resolved still 9',
  (SELECT count(*)::text FROM app_reports WHERE node = 'app-reports-close-out-proof' AND status = 'resolved'), '9');
SELECT pg_temp.assert_eq('re-apply is a no-op: dismissed still 21',
  (SELECT count(*)::text FROM app_reports WHERE node = 'app-reports-close-out-proof' AND status = 'dismissed'), '21');
SELECT pg_temp.assert_eq('re-apply is a no-op: 4 near-miss rows still new',
  (SELECT count(*)::text FROM app_reports WHERE node = 'app-reports-close-out-proof' AND status = 'new'), '4');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
