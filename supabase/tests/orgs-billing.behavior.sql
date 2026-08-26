-- ============================================================================
-- Behavioral proof: pools, allocations, caps, and the payer-aware
-- reserve/commit/refund (migration 351).
--
-- Runs AFTER the whole migration chain, as `postgres`, inside one transaction
-- that rolls back. Its own uuid range (…-000000000501 upward) so it can never
-- collide with the sibling proofs.
--
-- The assertions that matter most:
--   * a workspace-paid reserve leaves `profiles` UNTOUCHED — work done inside
--     a class is paid by the class (owner decision, 2026-08-25), and the member's own
--     balance never moves for it;
--   * the metered-overrun commit is CLAMPED and writes an org_usage_variance
--     row — the budget CHECK is an unconditional invariant, not a hope;
--   * an implicit admin (org admin, no workspace_members row) reserves with
--     no spend row — the FK would refuse one, and the branch never tries.
--
-- Run locally:
--   docker run -d --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/orgs-billing.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql
--
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, COALESCE(got, 'NULL'), COALESCE(want, 'NULL');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- Runs a statement that MUST raise, and the message must start with the given
-- stable prefix. The nested block's implicit savepoint rolls back anything
-- the statement wrote before failing.
CREATE FUNCTION pg_temp.assert_raises(label text, stmt text, prefix text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(prefix in SQLERRM) = 1 THEN
      RAISE NOTICE 'ok  %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ASSERT FAIL [%]: raised "%" but expected prefix "%"', label, SQLERRM, prefix;
  END;
  RAISE EXCEPTION 'ASSERT FAIL [%]: expected an exception with prefix "%" and none was raised', label, prefix;
END $$;

-- ---------------------------------------------------------------- fixtures
-- owner (o) owns the org. member (m) explicit uncapped. capped (c) explicit,
-- credit_cap 50. impadmin (i) is an ORG admin with NO workspace_members row.
-- loner (l) belongs to nothing — the personal-branch sanity check.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000501', 'bill-owner@example.com'),
  ('00000000-0000-4000-8000-000000000502', 'bill-member@example.com'),
  ('00000000-0000-4000-8000-000000000503', 'bill-capped@example.com'),
  ('00000000-0000-4000-8000-000000000504', 'bill-impadmin@example.com'),
  ('00000000-0000-4000-8000-000000000505', 'bill-loner@example.com');

-- kind 'school': the preset resolves member_caps_enabled = true, so a set cap
-- actually binds without any settings override.
INSERT INTO organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES
  ('a0000000-0000-4000-8000-000000000501', 'bill-org', 'Billing Org', 'school',
   '00000000-0000-4000-8000-000000000501', 'active', '{}'::jsonb);

INSERT INTO workspaces (id, org_id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000501', 'a0000000-0000-4000-8000-000000000501', 'Billing WS', 'bill-ws');

INSERT INTO organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000501', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000503', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000504', 'admin',  'active');

INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status, credit_cap) VALUES
  ('b0000000-0000-4000-8000-000000000501', 'a0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', 'member', 'active', NULL),
  ('b0000000-0000-4000-8000-000000000501', 'a0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000503', 'member', 'active', 50);

-- The member arrives with a personal balance — the proof that it never moves.
UPDATE profiles SET subscription_credits = 700, topup_credits = 300, daily_spent_credits = 0
WHERE id IN ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000505');

-- ------------------------------------------------- grant: idempotent, once
SELECT pg_temp.assert_eq('first grant of 1000 is applied',
  grant_org_credits_idempotent('a0000000-0000-4000-8000-000000000501', 1000, 'cs_test_501', 'org_purchase', 25.00)::text, 'true');
SELECT pg_temp.assert_eq('redelivered grant is refused',
  grant_org_credits_idempotent('a0000000-0000-4000-8000-000000000501', 1000, 'cs_test_501', 'org_purchase', 25.00)::text, 'false');
SELECT pg_temp.assert_eq('pool holds exactly one grant',
  (SELECT available_credits::text FROM organization_credit_accounts WHERE org_id = 'a0000000-0000-4000-8000-000000000501'), '1000');
SELECT pg_temp.assert_eq('lifetime purchased tracks it',
  (SELECT lifetime_purchased_credits::text FROM organization_credit_accounts WHERE org_id = 'a0000000-0000-4000-8000-000000000501'), '1000');
SELECT pg_temp.assert_eq('exactly one claim row in transactions',
  (SELECT count(*)::text FROM transactions WHERE stripe_transaction_id = 'cs_test_501'), '1');
SELECT pg_temp.assert_eq('the claim row is org-marked',
  (SELECT (org_id IS NOT NULL)::text FROM transactions WHERE stripe_transaction_id = 'cs_test_501'), 'true');
SELECT pg_temp.assert_eq('an admin grant lands too (org_admin_grant)',
  grant_org_credits_idempotent('a0000000-0000-4000-8000-000000000501', 200, 'admin:00000000-0000-4000-8000-00000000a501', 'org_admin_grant')::text, 'true');
SELECT pg_temp.assert_raises('an unknown grant source is refused',
  $q$SELECT grant_org_credits_idempotent('a0000000-0000-4000-8000-000000000501', 10, 'x-bad-source', 'usage')$q$,
  'Invalid org grant source');

-- ------------------------------------------------- allocate + over-allocate
SELECT pg_temp.assert_eq('allocating 600 returns headroom 600',
  allocate_workspace_credits('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', 600,
    '00000000-0000-4000-8000-000000000501')::text, '600');
SELECT pg_temp.assert_eq('pool drops to 600 (1200 - 600)',
  (SELECT available_credits::text FROM organization_credit_accounts WHERE org_id = 'a0000000-0000-4000-8000-000000000501'), '600');
SELECT pg_temp.assert_raises('over-allocation is refused',
  $q$SELECT allocate_workspace_credits('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', 601, '00000000-0000-4000-8000-000000000501')$q$,
  'ORG_POOL_EXCEEDED');
SELECT pg_temp.assert_raises('allocating to a foreign workspace is refused',
  $q$SELECT allocate_workspace_credits('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-0000000005ff', 10, '00000000-0000-4000-8000-000000000501')$q$,
  'WORKSPACE_NOT_FOUND');

-- ------------------------------------------------- reserve: member, uncapped
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000000502', 100, NULL, 'test-model', NULL, NULL, FALSE, NULL, FALSE,
                           'b0000000-0000-4000-8000-000000000501');
  PERFORM pg_temp.assert_eq('workspace reserve returns a usage log', (v_log IS NOT NULL)::text, 'true');
  PERFORM pg_temp.assert_eq('usage log carries the workspace',
    (SELECT workspace_id::text FROM usage_logs WHERE id = v_log), 'b0000000-0000-4000-8000-000000000501');
  PERFORM pg_temp.assert_eq('usage log carries the org',
    (SELECT org_id::text FROM usage_logs WHERE id = v_log), 'a0000000-0000-4000-8000-000000000501');
  PERFORM pg_temp.assert_eq('payer metadata says workspace',
    (SELECT metadata->'payer'->>'kind' FROM usage_logs WHERE id = v_log), 'workspace');
  PERFORM pg_temp.assert_eq('uncapped member touched no spend row (member_spend=false)',
    (SELECT metadata->'payer'->>'member_spend' FROM usage_logs WHERE id = v_log), 'false');
  PERFORM pg_temp.assert_eq('budget reserved 100',
    (SELECT reserved_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501'), '100');
  PERFORM pg_temp.assert_eq('no spend row was created for the uncapped member',
    (SELECT count(*)::text FROM workspace_member_spend WHERE user_id = '00000000-0000-4000-8000-000000000502'), '0');
  -- §5b: the class pays; the member's own balance never moves.
  PERFORM pg_temp.assert_eq('member profile subscription untouched',
    (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000502'), '700');
  PERFORM pg_temp.assert_eq('member profile topup untouched',
    (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000502'), '300');
  PERFORM pg_temp.assert_eq('member daily counter untouched',
    (SELECT COALESCE(daily_spent_credits, 0)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000502'), '0');

  -- commit at 80: reservation released, 80 spent, log committed at 80.
  PERFORM commit_credits(v_log, 80);
  PERFORM pg_temp.assert_eq('commit released the reservation',
    (SELECT reserved_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501'), '0');
  PERFORM pg_temp.assert_eq('commit spent the actual',
    (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501'), '80');
  PERFORM pg_temp.assert_eq('log committed at actual',
    (SELECT credits_charged::text FROM usage_logs WHERE id = v_log), '80');
  PERFORM pg_temp.assert_eq('profiles still untouched after commit',
    (SELECT (subscription_credits = 700 AND topup_credits = 300)::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000502'), 'true');
END $$;

-- ------------------------------------------------- reserve: capped member
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000000503', 40, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE,
                           'b0000000-0000-4000-8000-000000000501');
  PERFORM pg_temp.assert_eq('capped member reserve records member_spend=true',
    (SELECT metadata->'payer'->>'member_spend' FROM usage_logs WHERE id = v_log), 'true');
  PERFORM pg_temp.assert_eq('spend row created lazily with the reservation',
    (SELECT reserved_credits::text FROM workspace_member_spend
      WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501' AND user_id = '00000000-0000-4000-8000-000000000503'), '40');
  PERFORM pg_temp.assert_raises('the cap refuses what would exceed it (40 + 20 > 50)',
    format($q$SELECT reserve_credits('00000000-0000-4000-8000-000000000503', 20, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, %L)$q$,
           'b0000000-0000-4000-8000-000000000501'),
    'MEMBER_CAP_EXCEEDED');
  PERFORM commit_credits(v_log, 40);
  PERFORM pg_temp.assert_eq('member spend row committed: reserved 0, spent 40',
    (SELECT (reserved_credits = 0 AND spent_credits = 40)::text FROM workspace_member_spend
      WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501' AND user_id = '00000000-0000-4000-8000-000000000503'), 'true');
  -- reset_member_spend clears spent only.
  PERFORM reset_member_spend('b0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000503');
  PERFORM pg_temp.assert_eq('reset zeroes spent and stamps reset_at',
    (SELECT (spent_credits = 0 AND reset_at IS NOT NULL)::text FROM workspace_member_spend
      WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501' AND user_id = '00000000-0000-4000-8000-000000000503'), 'true');
END $$;

SELECT pg_temp.assert_raises('capping an implicit admin is refused (no explicit row)',
  $q$SELECT set_member_credit_cap('b0000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000504', 10)$q$,
  'MEMBER_NOT_FOUND');

-- ------------------------------------------------- implicit admin reserves
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000000504', 30, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE,
                           'b0000000-0000-4000-8000-000000000501');
  PERFORM pg_temp.assert_eq('implicit admin reserves against the budget',
    (SELECT reserved_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501'), '30');
  PERFORM pg_temp.assert_eq('implicit admin never gets a spend row',
    (SELECT count(*)::text FROM workspace_member_spend WHERE user_id = '00000000-0000-4000-8000-000000000504'), '0');
  PERFORM refund_credits(v_log);
  PERFORM pg_temp.assert_eq('refund released the implicit admin reservation',
    (SELECT reserved_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501'), '0');
  PERFORM pg_temp.assert_eq('refund marked the log',
    (SELECT status FROM usage_logs WHERE id = v_log), 'refunded');
END $$;

-- ------------------------------------------------- refusals
SELECT pg_temp.assert_raises('budget refuses more than headroom (600 alloc - 120 spent = 480)',
  $q$SELECT reserve_credits('00000000-0000-4000-8000-000000000502', 481, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000501')$q$,
  'BUDGET_EXCEEDED');
SELECT pg_temp.assert_raises('a workspace with no allocation refuses uniformly',
  $q$SELECT reserve_credits('00000000-0000-4000-8000-000000000502', 1, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-0000000005ee')$q$,
  'WORKSPACE_NOT_FOUND');

UPDATE workspaces SET archived_at = now() WHERE id = 'b0000000-0000-4000-8000-000000000501';
SELECT pg_temp.assert_raises('an archived workspace refuses to spend',
  $q$SELECT reserve_credits('00000000-0000-4000-8000-000000000502', 1, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000501')$q$,
  'WORKSPACE_ARCHIVED');
UPDATE workspaces SET archived_at = NULL WHERE id = 'b0000000-0000-4000-8000-000000000501';

UPDATE workspace_members SET status = 'suspended'
WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501' AND user_id = '00000000-0000-4000-8000-000000000502';
SELECT pg_temp.assert_raises('a suspended member refuses to spend',
  $q$SELECT reserve_credits('00000000-0000-4000-8000-000000000502', 1, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000501')$q$,
  'MEMBER_SUSPENDED');
UPDATE workspace_members SET status = 'active'
WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501' AND user_id = '00000000-0000-4000-8000-000000000502';

-- ------------------------------------------------- metered overrun clamps
DO $$
DECLARE v_log UUID; v_headroom INTEGER;
BEGIN
  -- Budget state here: allocated 600, reserved 0, spent 120 → headroom 480.
  v_log := reserve_credits('00000000-0000-4000-8000-000000000502', 100, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE,
                           'b0000000-0000-4000-8000-000000000501');
  -- A metered provider comes back at 1000 — far beyond the 480 headroom.
  PERFORM commit_credits(v_log, 1000);
  PERFORM pg_temp.assert_eq('overrun spend clamped to headroom (120 + 480 = 600 = allocated)',
    (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501'), '600');
  PERFORM pg_temp.assert_eq('the CHECK invariant holds after the overrun',
    (SELECT (reserved_credits + spent_credits <= allocated_credits)::text
       FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000501'), 'true');
  PERFORM pg_temp.assert_eq('the shortfall is a platform-absorbed variance row (1000 - 480)',
    (SELECT amount::text FROM credit_transactions
      WHERE source = 'org_usage_variance' AND workspace_id = 'b0000000-0000-4000-8000-000000000501'), '520');
  PERFORM pg_temp.assert_eq('the log still records the true actual',
    (SELECT credits_charged::text FROM usage_logs WHERE id = v_log), '1000');
END $$;

-- ------------------------------------------------- reclaim is bounded
SELECT pg_temp.assert_raises('reclaim beyond the unspent slice is refused (allocated 600, spent 600)',
  $q$SELECT allocate_workspace_credits('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', -1, '00000000-0000-4000-8000-000000000501')$q$,
  'RECLAIM_EXCEEDS_AVAILABLE');
-- Free some headroom, then reclaim exactly it.
SELECT pg_temp.assert_eq('re-allocating 100 lifts headroom to 100',
  allocate_workspace_credits('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', 100,
    '00000000-0000-4000-8000-000000000501')::text, '100');
SELECT pg_temp.assert_eq('reclaiming the free 100 returns headroom 0',
  allocate_workspace_credits('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', -100,
    '00000000-0000-4000-8000-000000000501')::text, '0');
SELECT pg_temp.assert_eq('the pool got the reclaim back',
  (SELECT available_credits::text FROM organization_credit_accounts WHERE org_id = 'a0000000-0000-4000-8000-000000000501'), '600');

-- ------------------------------------------------- clawback floors at zero
SELECT pg_temp.assert_eq('clawback within the pool leaves no shortfall',
  claw_back_org_credits('a0000000-0000-4000-8000-000000000501', 100, 'evt_refund_501')::text, '0');
SELECT pg_temp.assert_eq('pool after clawback',
  (SELECT available_credits::text FROM organization_credit_accounts WHERE org_id = 'a0000000-0000-4000-8000-000000000501'), '500');
SELECT pg_temp.assert_eq('a redelivered clawback event is a no-op',
  claw_back_org_credits('a0000000-0000-4000-8000-000000000501', 100, 'evt_refund_501')::text, '0');
SELECT pg_temp.assert_eq('pool unchanged by the redelivery',
  (SELECT available_credits::text FROM organization_credit_accounts WHERE org_id = 'a0000000-0000-4000-8000-000000000501'), '500');
SELECT pg_temp.assert_eq('an oversized clawback floors at zero and reports the shortfall',
  claw_back_org_credits('a0000000-0000-4000-8000-000000000501', 900, 'evt_refund_502')::text, '400');
SELECT pg_temp.assert_eq('pool floored at zero',
  (SELECT available_credits::text FROM organization_credit_accounts WHERE org_id = 'a0000000-0000-4000-8000-000000000501'), '0');
SELECT pg_temp.assert_eq('the shortfall is written into the ledger row',
  (SELECT (description LIKE '%SHORTFALL 400%')::text FROM credit_transactions
    WHERE stripe_transaction_id = 'evt_refund_502' AND source = 'org_refund'), 'true');

-- ------------------------------------------------- personal branch sanity
-- The loner pays personally, exactly as before 351 (the full personal matrix
-- lives in the long-standing suites; this pins that the new parameter's
-- default engages the untouched branch).
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000000505', 100, NULL, 'personal-model', NULL, NULL, FALSE, NULL, FALSE);
  PERFORM pg_temp.assert_eq('personal reserve deducts subscription first',
    (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000505'), '600');
  PERFORM pg_temp.assert_eq('personal usage log has NO workspace',
    (SELECT (workspace_id IS NULL AND org_id IS NULL)::text FROM usage_logs WHERE id = v_log), 'true');
  PERFORM refund_credits(v_log);
  PERFORM pg_temp.assert_eq('personal refund restores the pool',
    (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000000505'), '700');
END $$;

-- ------------------------------------------------- the source CHECK admits
-- every org value (probe rows, deleted by the rollback like everything else)
INSERT INTO credit_transactions (user_id, amount, credit_type, source, description)
SELECT '00000000-0000-4000-8000-000000000501', 1, 'org', s, 'check probe'
FROM unnest(ARRAY['org_usage', 'stripe_refund']) AS s;
SELECT pg_temp.assert_eq('org_usage and stripe_refund are admitted by the CHECK',
  (SELECT count(*)::text FROM credit_transactions WHERE description = 'check probe'), '2');

-- ------------------------------------------------- grants + search_path
SELECT pg_temp.assert_eq('anon cannot execute any billing RPC',
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::text FROM pg_proc p
    WHERE proname IN ('reserve_credits','commit_credits','refund_credits','allocate_workspace_credits',
                      'grant_org_credits_idempotent','set_member_credit_cap','reset_member_spend','claw_back_org_credits')), 'false');
SELECT pg_temp.assert_eq('authenticated cannot either',
  (SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text FROM pg_proc p
    WHERE proname IN ('reserve_credits','commit_credits','refund_credits','allocate_workspace_credits',
                      'grant_org_credits_idempotent','set_member_credit_cap','reset_member_spend','claw_back_org_credits')), 'false');
SELECT pg_temp.assert_eq('service_role can execute all eight',
  (SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))::text FROM pg_proc p
    WHERE proname IN ('reserve_credits','commit_credits','refund_credits','allocate_workspace_credits',
                      'grant_org_credits_idempotent','set_member_credit_cap','reset_member_spend','claw_back_org_credits')), 'true');
SELECT pg_temp.assert_eq('every billing definer pins search_path with pg_temp',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname IN ('reserve_credits','commit_credits','refund_credits','allocate_workspace_credits',
                      'grant_org_credits_idempotent','set_member_credit_cap','reset_member_spend','claw_back_org_credits')
      AND prosecdef
      AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'), '8');
SELECT pg_temp.assert_eq('exactly one reserve_credits exists (no PostgREST overload)',
  (SELECT count(*)::text FROM pg_proc WHERE proname = 'reserve_credits'), '1');
SELECT pg_temp.assert_eq('the budget CHECK constraint exists',
  (SELECT count(*)::text FROM pg_constraint
    WHERE conrelid = 'workspace_budgets'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%reserved_credits + spent_credits%'), '1');
SELECT pg_temp.assert_eq('stripe_customers enforces exactly-one owner',
  (SELECT count(*)::text FROM pg_constraint WHERE conname = 'stripe_customers_one_owner'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
