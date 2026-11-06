-- ============================================================================
-- Behavioral proof — 599_app_fee_collected_only.sql
-- ============================================================================
-- Runs after the full migration chain (CI: migration-behavior job), inside a
-- transaction it rolls back. On the personal-payer path of
-- process_app_monetization:
--   * a runner holding less than the fee is charged at most their balance;
--   * the creator is credited exactly what was collected, never more;
--   * no balance goes below zero through this path (a runner already at or
--     below zero pays nothing);
--   * app_earnings and credit_transactions show the real amounts, and the
--     fee that was asked stays visible (flat_fee + percent_fee);
--   * a repeat call for the same run changes nothing, even after the runner
--     has topped up;
--   * a runner who can pay the whole fee is charged it, as before.
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
-- Five runners, one per scenario, and one creator.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000005901', 'fee-runner-a@example.com'),
  ('00000000-0000-4000-8000-000000005902', 'fee-runner-c@example.com'),
  ('00000000-0000-4000-8000-000000005903', 'fee-runner-d@example.com'),
  ('00000000-0000-4000-8000-000000005904', 'fee-runner-e@example.com'),
  ('00000000-0000-4000-8000-000000005905', 'fee-runner-f@example.com'),
  ('00000000-0000-4000-8000-000000005909', 'fee-creator@example.com');

UPDATE profiles SET subscription_credits = 30,  topup_credits = 20 WHERE id = '00000000-0000-4000-8000-000000005901';
UPDATE profiles SET subscription_credits = -10, topup_credits = 0  WHERE id = '00000000-0000-4000-8000-000000005902';
UPDATE profiles SET subscription_credits = -10, topup_credits = 25 WHERE id = '00000000-0000-4000-8000-000000005903';
UPDATE profiles SET subscription_credits = 100, topup_credits = 0  WHERE id = '00000000-0000-4000-8000-000000005904';
UPDATE profiles SET subscription_credits = 20,  topup_credits = 10 WHERE id = '00000000-0000-4000-8000-000000005905';
UPDATE profiles SET subscription_credits = 0,   topup_credits = 0, total_earnings = 0 WHERE id = '00000000-0000-4000-8000-000000005909';

INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005909', 'Fee Project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000005901', 'c0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005909', 'Fee Workflow');
INSERT INTO published_apps (id, workflow_id, creator_id, version, slug, name, snapshot_nodes, snapshot_edges) VALUES
  ('f0000000-0000-4000-8000-000000005901', 'd0000000-0000-4000-8000-000000005901',
   '00000000-0000-4000-8000-000000005909', 1, 'fee-app', 'Fee App', '[]'::jsonb, '[]'::jsonb);

INSERT INTO workflow_executions (id, workflow_id, user_id) VALUES
  ('e0000000-0000-4000-8000-000000005901', 'd0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005901'),
  ('e0000000-0000-4000-8000-000000005902', 'd0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005902'),
  ('e0000000-0000-4000-8000-000000005903', 'd0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005903'),
  ('e0000000-0000-4000-8000-000000005904', 'd0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005904'),
  ('e0000000-0000-4000-8000-000000005905', 'd0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005905');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000005901', 'f0000000-0000-4000-8000-000000005901', 'e0000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005901'),
  ('90000000-0000-4000-8000-000000005902', 'f0000000-0000-4000-8000-000000005901', 'e0000000-0000-4000-8000-000000005902', '00000000-0000-4000-8000-000000005902'),
  ('90000000-0000-4000-8000-000000005903', 'f0000000-0000-4000-8000-000000005901', 'e0000000-0000-4000-8000-000000005903', '00000000-0000-4000-8000-000000005903'),
  ('90000000-0000-4000-8000-000000005904', 'f0000000-0000-4000-8000-000000005901', 'e0000000-0000-4000-8000-000000005904', '00000000-0000-4000-8000-000000005904'),
  ('90000000-0000-4000-8000-000000005905', 'f0000000-0000-4000-8000-000000005901', 'e0000000-0000-4000-8000-000000005905', '00000000-0000-4000-8000-000000005905');

-- ------------------- A: a fee of 500 against a balance of 50 (30 + 20)
SELECT pg_temp.assert_eq('A: a runner holding less than the fee is charged at most their balance (returns what was collected)',
  process_app_monetization('00000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005909',
    500, 'f0000000-0000-4000-8000-000000005901', '90000000-0000-4000-8000-000000005901', 10, 500, 0, NULL)::text, '50');
SELECT pg_temp.assert_eq('A: the creator is credited exactly the collected amount',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000005909'), '50');
SELECT pg_temp.assert_eq('A: the creator''s total earnings rise by the collected amount',
  (SELECT total_earnings::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000005909'), '50');
SELECT pg_temp.assert_eq('A: the runner ends at zero in both pools, never below',
  (SELECT subscription_credits || '/' || topup_credits FROM profiles WHERE id = '00000000-0000-4000-8000-000000005901'), '0/0');
SELECT pg_temp.assert_eq('A: app_earnings records what was collected, and the fee that was asked',
  (SELECT base_cost || '/' || flat_fee || '/' || percent_fee || '/' || total_earned || '/' || total_charged
     FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000005901'), '10/500/0/50/60');
SELECT pg_temp.assert_eq('A: the uncollected part is readable from the earnings row',
  (SELECT (flat_fee + percent_fee - total_earned)::text FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000005901'), '450');
SELECT pg_temp.assert_eq('A: the runner''s debit row carries the collected amount, from both pools',
  (SELECT amount || '/' || credit_type || '/' || balance_after FROM credit_transactions
     WHERE user_id = '00000000-0000-4000-8000-000000005901' AND source = 'app_markup'), '-50/mixed/0');
SELECT pg_temp.assert_eq('A: the creator''s credit row carries the collected amount',
  (SELECT string_agg(amount::text, ',') FROM credit_transactions
     WHERE user_id = '00000000-0000-4000-8000-000000005909' AND source = 'app_earnings'), '50');

-- ------------------------- B: a repeat call for A's run changes nothing,
-- even though the runner now has the credits to pay the rest.
UPDATE profiles SET topup_credits = 1000 WHERE id = '00000000-0000-4000-8000-000000005901';
SELECT pg_temp.assert_eq('B: a repeat call returns 0',
  process_app_monetization('00000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005909',
    500, 'f0000000-0000-4000-8000-000000005901', '90000000-0000-4000-8000-000000005901', 10, 500, 0, NULL)::text, '0');
SELECT pg_temp.assert_eq('B: the runner is not charged again',
  (SELECT subscription_credits || '/' || topup_credits FROM profiles WHERE id = '00000000-0000-4000-8000-000000005901'), '0/1000');
SELECT pg_temp.assert_eq('B: the creator is not credited again',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000005909'), '50');
SELECT pg_temp.assert_eq('B: the earnings row is unchanged',
  (SELECT count(*) || '/' || max(total_earned) FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000005901'), '1/50');
SELECT pg_temp.assert_eq('B: no second ledger row for the runner',
  (SELECT count(*)::text FROM credit_transactions
     WHERE user_id = '00000000-0000-4000-8000-000000005901' AND source = 'app_markup'), '1');

-- ---------------- C: a runner already below zero (-10 + 0) pays nothing
SELECT pg_temp.assert_eq('C: a runner below zero is charged nothing',
  process_app_monetization('00000000-0000-4000-8000-000000005902', '00000000-0000-4000-8000-000000005909',
    40, 'f0000000-0000-4000-8000-000000005901', '90000000-0000-4000-8000-000000005902', 10, 40, 0, NULL)::text, '0');
SELECT pg_temp.assert_eq('C: the runner''s balance did not move further below zero',
  (SELECT subscription_credits || '/' || topup_credits FROM profiles WHERE id = '00000000-0000-4000-8000-000000005902'), '-10/0');
SELECT pg_temp.assert_eq('C: the creator is credited nothing',
  (SELECT topup_credits || '/' || total_earnings FROM profiles WHERE id = '00000000-0000-4000-8000-000000005909'), '50/50');
SELECT pg_temp.assert_eq('C: the run is still recorded, with nothing collected',
  (SELECT total_earned || '/' || total_charged || '/' || flat_fee FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000005902'), '0/10/40');
SELECT pg_temp.assert_eq('C: no ledger row is written for a charge of nothing',
  (SELECT count(*)::text FROM credit_transactions WHERE user_id = '00000000-0000-4000-8000-000000005902' AND source = 'app_markup'), '0');
SELECT pg_temp.assert_eq('C: a repeat call still returns 0 and writes nothing',
  process_app_monetization('00000000-0000-4000-8000-000000005902', '00000000-0000-4000-8000-000000005909',
    40, 'f0000000-0000-4000-8000-000000005901', '90000000-0000-4000-8000-000000005902', 10, 40, 0, NULL)::text
  || '/' || (SELECT count(*) FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000005902'), '0/1');

-- ------ D: a negative subscription pool beside a positive top-up pool
-- (-10 + 25 = 15 spendable): the fee of 40 collects 15, all from top-up.
SELECT pg_temp.assert_eq('D: collects the spendable total, not the positive pool alone',
  process_app_monetization('00000000-0000-4000-8000-000000005903', '00000000-0000-4000-8000-000000005909',
    40, 'f0000000-0000-4000-8000-000000005901', '90000000-0000-4000-8000-000000005903', 10, 30, 10, NULL)::text, '15');
SELECT pg_temp.assert_eq('D: the runner ends at a total of zero; no pool taken below zero',
  (SELECT subscription_credits || '/' || topup_credits || '/' || (subscription_credits + topup_credits)
     FROM profiles WHERE id = '00000000-0000-4000-8000-000000005903'), '-10/10/0');
SELECT pg_temp.assert_eq('D: the creator is credited the 15 collected',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000005909'), '65');
SELECT pg_temp.assert_eq('D: the ledger rows carry 15 each way',
  (SELECT amount || '/' || credit_type FROM credit_transactions
     WHERE user_id = '00000000-0000-4000-8000-000000005903' AND source = 'app_markup'), '-15/topup');
SELECT pg_temp.assert_eq('D: the earnings row keeps both fee parts and the collected total',
  (SELECT flat_fee || '/' || percent_fee || '/' || total_earned FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000005903'), '30/10/15');

-- -------------- E: a runner who can pay the whole fee — unchanged behaviour
SELECT pg_temp.assert_eq('E: the whole fee is charged when the runner can pay it',
  process_app_monetization('00000000-0000-4000-8000-000000005904', '00000000-0000-4000-8000-000000005909',
    30, 'f0000000-0000-4000-8000-000000005901', '90000000-0000-4000-8000-000000005904', 10, 20, 10, NULL)::text, '30');
SELECT pg_temp.assert_eq('E: from the subscription pool',
  (SELECT subscription_credits || '/' || topup_credits FROM profiles WHERE id = '00000000-0000-4000-8000-000000005904'), '70/0');
SELECT pg_temp.assert_eq('E: the creator is credited the whole fee',
  (SELECT topup_credits || '/' || total_earnings FROM profiles WHERE id = '00000000-0000-4000-8000-000000005909'), '95/95');
SELECT pg_temp.assert_eq('E: the earnings row is the whole fee',
  (SELECT total_earned || '/' || total_charged FROM app_earnings WHERE run_id = '90000000-0000-4000-8000-000000005904'), '30/40');
SELECT pg_temp.assert_eq('E: the debit row is the whole fee from subscription',
  (SELECT amount || '/' || credit_type || '/' || balance_after FROM credit_transactions
     WHERE user_id = '00000000-0000-4000-8000-000000005904' AND source = 'app_markup'), '-30/subscription/70');

-- -------- F: a fee exactly equal to the balance (20 + 10) is collected whole
SELECT pg_temp.assert_eq('F: a fee equal to the balance is collected whole',
  process_app_monetization('00000000-0000-4000-8000-000000005905', '00000000-0000-4000-8000-000000005909',
    30, 'f0000000-0000-4000-8000-000000005901', '90000000-0000-4000-8000-000000005905', 10, 30, 0, NULL)::text, '30');
SELECT pg_temp.assert_eq('F: both pools end at zero',
  (SELECT subscription_credits || '/' || topup_credits FROM profiles WHERE id = '00000000-0000-4000-8000-000000005905'), '0/0');

-- ------------------------------------------------------------ the totals
-- Everything the creator received is exactly what the runners gave up.
SELECT pg_temp.assert_eq('the creator''s credits equal the sum collected from the runners',
  (SELECT topup_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000005909'),
  (SELECT sum(total_earned)::text FROM app_earnings WHERE app_id = 'f0000000-0000-4000-8000-000000005901'));
SELECT pg_temp.assert_eq('the runners'' debit rows sum to what the creator was credited',
  (SELECT (-sum(amount))::text FROM credit_transactions WHERE source = 'app_markup'
     AND user_id IN ('00000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005902',
                     '00000000-0000-4000-8000-000000005903', '00000000-0000-4000-8000-000000005904',
                     '00000000-0000-4000-8000-000000005905')),
  (SELECT sum(amount)::text FROM credit_transactions
     WHERE user_id = '00000000-0000-4000-8000-000000005909' AND source = 'app_earnings'));
SELECT pg_temp.assert_eq('no runner whose balance was at or above zero ends below it',
  (SELECT count(*)::text FROM profiles
     WHERE id IN ('00000000-0000-4000-8000-000000005901', '00000000-0000-4000-8000-000000005903',
                  '00000000-0000-4000-8000-000000005904', '00000000-0000-4000-8000-000000005905')
       AND subscription_credits + topup_credits < 0), '0');

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

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
