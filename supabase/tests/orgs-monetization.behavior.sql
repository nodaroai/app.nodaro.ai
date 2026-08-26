-- ============================================================================
-- Behavioral proof — 352_orgs_app_monetization_payer.sql
-- ============================================================================
-- Runs after the full migration chain (CI: migration-behavior job), inside a
-- transaction it rolls back. The assertions that matter most:
--   * an app the org has NOT approved bills its markup to the RUNNER
--     personally — the workspace payer changes nothing for it;
--   * an APPROVED app bills the WORKSPACE: budget spent rises (clamped to
--     headroom, shortfall absorbed as an org_usage_variance row), and the
--     runner's own `profiles` row never moves;
--   * the creator is paid IN FULL on every path, clamp or not;
--   * the run-id mutex still deduplicates re-entry on both branches;
--   * the approval survives a REPUBLISH (workflow-keyed — owner decision);
--   * app_earnings records who actually paid (payer_workspace_id);
--   * the grants and the approval table's RLS hold BEHAVIORALLY (SET ROLE).
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, got text, want text) RETURNS void AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'ASSERT FAILED: % — got %, want %', label, coalesce(got, '<null>'), coalesce(want, '<null>');
  END IF;
END;
$fn$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- fixtures
-- runner (r) is an active member of the workspace and arrives with a personal
-- balance — the proof that approved-app markup never touches it. creator (c)
-- is OUTSIDE the organization (the collusion shape the approval list guards).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000701', 'mon-runner@example.com'),
  ('00000000-0000-4000-8000-000000000702', 'mon-creator@example.com'),
  ('00000000-0000-4000-8000-000000000703', 'mon-owner@example.com'),
  ('00000000-0000-4000-8000-000000000704', 'mon-outsider@example.com');

INSERT INTO organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES
  ('a0000000-0000-4000-8000-000000000701', 'mon-org', 'Monetization Org', 'school',
   '00000000-0000-4000-8000-000000000703', 'active', '{}'::jsonb);

INSERT INTO workspaces (id, org_id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000701', 'a0000000-0000-4000-8000-000000000701', 'Mon WS', 'mon-ws'),
  ('b0000000-0000-4000-8000-000000000702', 'a0000000-0000-4000-8000-000000000701', 'Mon WS 2', 'mon-ws-2');

INSERT INTO organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000703', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701', 'member', 'active');

INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status) VALUES
  ('b0000000-0000-4000-8000-000000000701', 'a0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701', 'member', 'active');

INSERT INTO workspace_budgets (workspace_id, allocated_credits, reserved_credits, spent_credits) VALUES
  ('b0000000-0000-4000-8000-000000000701', 200, 0, 0);
-- b…702 deliberately has NO budget row.

UPDATE profiles SET subscription_credits = 100, topup_credits = 50 WHERE id = '00000000-0000-4000-8000-000000000701';
UPDATE profiles SET subscription_credits = 0,   topup_credits = 0,  total_earnings = 0 WHERE id = '00000000-0000-4000-8000-000000000702';

-- The app + one execution/run per scenario (app_earnings keys on run_id).
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702', 'Mon Project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000000701', 'c0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702', 'Mon Workflow');
-- v1 AND v2 of the same app: every republish is a NEW published_apps row —
-- the approval must survive it by keying on the workflow (owner decision).
INSERT INTO published_apps (id, workflow_id, creator_id, version, slug, name, snapshot_nodes, snapshot_edges) VALUES
  ('f0000000-0000-4000-8000-000000000701', 'd0000000-0000-4000-8000-000000000701',
   '00000000-0000-4000-8000-000000000702', 1, 'mon-app', 'Mon App', '[]'::jsonb, '[]'::jsonb),
  ('f0000000-0000-4000-8000-000000000702', 'd0000000-0000-4000-8000-000000000701',
   '00000000-0000-4000-8000-000000000702', 2, 'mon-app-v2', 'Mon App', '[]'::jsonb, '[]'::jsonb);

INSERT INTO workflow_executions (id, workflow_id, user_id) VALUES
  ('e0000000-0000-4000-8000-000000000701', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701'),
  ('e0000000-0000-4000-8000-000000000702', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701'),
  ('e0000000-0000-4000-8000-000000000703', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701'),
  ('e0000000-0000-4000-8000-000000000704', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701'),
  ('e0000000-0000-4000-8000-000000000705', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701'),
  ('e0000000-0000-4000-8000-000000000706', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701'),
  ('e0000000-0000-4000-8000-000000000707', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000000701', 'f0000000-0000-4000-8000-000000000701', 'e0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701'),
  ('90000000-0000-4000-8000-000000000702', 'f0000000-0000-4000-8000-000000000701', 'e0000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000701'),
  ('90000000-0000-4000-8000-000000000703', 'f0000000-0000-4000-8000-000000000701', 'e0000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000701'),
  ('90000000-0000-4000-8000-000000000704', 'f0000000-0000-4000-8000-000000000701', 'e0000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000701'),
  ('90000000-0000-4000-8000-000000000705', 'f0000000-0000-4000-8000-000000000701', 'e0000000-0000-4000-8000-000000000705', '00000000-0000-4000-8000-000000000701'),
  ('90000000-0000-4000-8000-000000000706', 'f0000000-0000-4000-8000-000000000702', 'e0000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000701'),
  ('90000000-0000-4000-8000-000000000707', 'f0000000-0000-4000-8000-000000000701', 'e0000000-0000-4000-8000-000000000707', '00000000-0000-4000-8000-000000000701');

-- ------------------------------------------- S1: NULL workspace = 173 verbatim
SELECT pg_temp.assert_eq('S1 personal: returns the markup',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    30, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000701', 10, 0, 0, NULL)::text, '30');
SELECT pg_temp.assert_eq('S1: runner subscription debited',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '70');
SELECT pg_temp.assert_eq('S1: creator paid',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000702'), '30');
SELECT pg_temp.assert_eq('S1 re-entry: the mutex holds on the personal branch too',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    30, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000701', 10, 0, 0, NULL)::text, '0');
SELECT pg_temp.assert_eq('S1 re-entry: runner balance unchanged',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '70');

-- --------------------- S2: workspace payer but the app is NOT approved →
-- the runner still pays personally; the budget does not move.
SELECT pg_temp.assert_eq('S2 unapproved: returns the markup',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    20, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000702', 10, 0, 0,
    'b0000000-0000-4000-8000-000000000701')::text, '20');
SELECT pg_temp.assert_eq('S2: runner pays personally on an unapproved app',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '50');
SELECT pg_temp.assert_eq('S2: the workspace budget did NOT move',
  (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000701'), '0');

-- --------------------------------- S3: the org approves the app → the
-- workspace pays; the runner's profiles row NEVER moves again.
INSERT INTO organization_approved_apps (org_id, workflow_id, approved_by) VALUES
  ('a0000000-0000-4000-8000-000000000701', 'd0000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000703');

SELECT pg_temp.assert_eq('S3 approved: returns the markup',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    40, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000703', 10, 0, 0,
    'b0000000-0000-4000-8000-000000000701')::text, '40');
SELECT pg_temp.assert_eq('S3: the workspace pays',
  (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000701'), '40');
SELECT pg_temp.assert_eq('S3: runner subscription untouched',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '50');
SELECT pg_temp.assert_eq('S3: runner topup untouched',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '50');
SELECT pg_temp.assert_eq('S3: creator paid in full',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000702'), '90');
SELECT pg_temp.assert_eq('S3: no NEW personal app_markup debit row (S1+S2 rows only)',
  (SELECT count(*)::text FROM credit_transactions
   WHERE user_id = '00000000-0000-4000-8000-000000000701' AND source = 'app_markup'), '2');

-- ------------------------------------------- S4: re-entry is a no-op (mutex)
SELECT pg_temp.assert_eq('S4 re-entry: returns 0',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    40, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000703', 10, 0, 0,
    'b0000000-0000-4000-8000-000000000701')::text, '0');
SELECT pg_temp.assert_eq('S4: budget unchanged on re-entry',
  (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000701'), '40');
SELECT pg_temp.assert_eq('S4: creator not double-paid',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000702'), '90');

-- ------------- S5: markup beyond headroom CLAMPS; the shortfall is absorbed
-- as an org_usage_variance row; the creator is still paid in full; the
-- schema CHECK (reserved + spent <= allocated) survives by construction.
SELECT pg_temp.assert_eq('S5 clamp: returns the full markup (creator-facing)',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    500, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000704', 10, 0, 0,
    'b0000000-0000-4000-8000-000000000701')::text, '500');
SELECT pg_temp.assert_eq('S5: spent clamped to the allocation',
  (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000701'), '200');
SELECT pg_temp.assert_eq('S5: the shortfall is one variance row of 340',
  (SELECT amount::text FROM credit_transactions
   WHERE source = 'org_usage_variance' AND workspace_id = 'b0000000-0000-4000-8000-000000000701'
     AND description LIKE '%90000000-0000-4000-8000-000000000704%'), '340');
SELECT pg_temp.assert_eq('S5: creator paid in full despite the clamp',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000702'), '590');
SELECT pg_temp.assert_eq('S5: runner still untouched',
  (SELECT (subscription_credits + topup_credits)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '100');
SELECT pg_temp.assert_eq('S5: exactly ONE variance row for the workspace — none from the covered runs',
  (SELECT count(*)::text FROM credit_transactions
   WHERE source = 'org_usage_variance' AND workspace_id = 'b0000000-0000-4000-8000-000000000701'), '1');

-- ------ S6: an approved app in a workspace with NO budget row — everything
-- is variance, the creator is whole, nobody's profiles move.
SELECT pg_temp.assert_eq('S6 no-budget-row: returns the markup',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    25, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000705', 10, 0, 0,
    'b0000000-0000-4000-8000-000000000702')::text, '25');
SELECT pg_temp.assert_eq('S6: whole markup absorbed as variance',
  (SELECT amount::text FROM credit_transactions
   WHERE source = 'org_usage_variance' AND workspace_id = 'b0000000-0000-4000-8000-000000000702'), '25');
SELECT pg_temp.assert_eq('S6: creator whole',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000702'), '615');
SELECT pg_temp.assert_eq('S6: total_earnings tracks every path',
  (SELECT total_earnings::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000702'), '615');

-- ------ S7: REPUBLISH SURVIVAL (owner decision): v2 is a NEW published_apps
-- row; the workflow-keyed approval must still route the markup to the
-- workspace. Allocation raised first so the charge is visible (not clamped).
UPDATE workspace_budgets SET allocated_credits = 300
WHERE workspace_id = 'b0000000-0000-4000-8000-000000000701';
SELECT pg_temp.assert_eq('S7 republish: v2 of an approved app still bills the workspace',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    30, 'f0000000-0000-4000-8000-000000000702', '90000000-0000-4000-8000-000000000706', 10, 0, 0,
    'b0000000-0000-4000-8000-000000000701')::text, '30');
SELECT pg_temp.assert_eq('S7: the workspace paid for the new version',
  (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000701'), '230');
SELECT pg_temp.assert_eq('S7: runner still untouched across the republish',
  (SELECT (subscription_credits + topup_credits)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '100');

-- ------ S8: an UNRESOLVABLE workspace (deleted between run start and this
-- post-run charge) falls to the personal body — the charge must land, and
-- the runner is the only payer left standing.
SELECT pg_temp.assert_eq('S8 unresolvable workspace: returns the markup',
  process_app_monetization('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
    30, 'f0000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000707', 10, 0, 0,
    'b0000000-0000-4000-8000-000000000709')::text, '30');
SELECT pg_temp.assert_eq('S8: the runner paid personally',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000701'), '20');

-- --------------------------------------------------------- bookkeeping shape
SELECT pg_temp.assert_eq('seven earnings rows — one per monetized run, none for re-entry',
  (SELECT count(*)::text FROM app_earnings
   WHERE app_id IN ('f0000000-0000-4000-8000-000000000701', 'f0000000-0000-4000-8000-000000000702')), '7');
-- Who actually paid, per run: NULL = the runner personally; a workspace id =
-- that workspace's budget (variance-absorbed runs still stamp the workspace).
SELECT pg_temp.assert_eq('payer stamp: personal runs carry NULL',
  (SELECT count(*)::text FROM app_earnings
   WHERE run_id IN ('90000000-0000-4000-8000-000000000701', '90000000-0000-4000-8000-000000000702', '90000000-0000-4000-8000-000000000707')
     AND payer_workspace_id IS NULL), '3');
SELECT pg_temp.assert_eq('payer stamp: workspace-paid runs carry the workspace',
  (SELECT count(*)::text FROM app_earnings
   WHERE run_id IN ('90000000-0000-4000-8000-000000000703', '90000000-0000-4000-8000-000000000704', '90000000-0000-4000-8000-000000000706')
     AND payer_workspace_id = 'b0000000-0000-4000-8000-000000000701'), '3');
SELECT pg_temp.assert_eq('payer stamp: the no-budget-row workspace is still the payer of record',
  (SELECT payer_workspace_id::text FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000000705'),
  'b0000000-0000-4000-8000-000000000702');

-- ------------------------------------------------- RLS: behavior, not shape
-- A member SEES the approval; an outsider sees nothing. SET LOCAL ROLE runs
-- the real policy (org_role over the caller's jwt), so a USING (true) leak
-- or an inverted predicate fails HERE, not in production.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000701","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000701';
SELECT pg_temp.assert_eq('RLS: an org member sees the approval',
  (SELECT count(*)::text FROM organization_approved_apps), '1');
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000704","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000704';
SELECT pg_temp.assert_eq('RLS: an outsider sees nothing',
  (SELECT count(*)::text FROM organization_approved_apps), '0');
RESET ROLE;

-- ------------------------------------------------------------------- grants
SELECT pg_temp.assert_eq('exactly one process_app_monetization exists (no overload pair)',
  (SELECT count(*)::text FROM pg_proc WHERE proname = 'process_app_monetization'), '1');
SELECT pg_temp.assert_eq('anon cannot execute it',
  (SELECT has_function_privilege('anon',
    'public.process_app_monetization(uuid,uuid,int,uuid,uuid,int,int,int,uuid)', 'EXECUTE'))::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot execute it',
  (SELECT has_function_privilege('authenticated',
    'public.process_app_monetization(uuid,uuid,int,uuid,uuid,int,int,int,uuid)', 'EXECUTE'))::text, 'false');
SELECT pg_temp.assert_eq('service_role can execute it',
  (SELECT has_function_privilege('service_role',
    'public.process_app_monetization(uuid,uuid,int,uuid,uuid,int,int,int,uuid)', 'EXECUTE'))::text, 'true');
SELECT pg_temp.assert_eq('search_path is pinned',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname = 'process_app_monetization'
      AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'), '1');

-- ------------------------------------------------- approval table discipline
SELECT pg_temp.assert_eq('organization_approved_apps has RLS enabled',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'organization_approved_apps'), 'true');
SELECT pg_temp.assert_eq('exactly one client policy on the approval table, a SELECT',
  (SELECT string_agg(DISTINCT cmd, ',') FROM pg_policies WHERE tablename = 'organization_approved_apps'), 'SELECT');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
