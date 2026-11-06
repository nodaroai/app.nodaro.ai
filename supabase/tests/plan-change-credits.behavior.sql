-- ============================================================================
-- Behavioral proof: a plan upgrade grants credits once per credit period, as
-- a gap, keyed by its paid invoice (migration 600).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000006001 upward).
--
-- WHAT IT PINS. The pool of a period is granted by a reset (subscription
-- created, the renewal, its safety net, the yearly plan's monthly grant), all
-- of which SET subscription_credits and stamp credits_reset_at together. A
-- paid upgrade adds only the gap above the highest plan the period has
-- granted; a replay of the same invoice is a no-op; a move down and back up
-- inside the period grants nothing; a new period starts from what its reset
-- granted; a monthly <-> yearly switch grants nothing and keeps the yearly
-- plan's monthly grant off the restarted period's first day; no browser role
-- can call the functions or read the table.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/plan-change-credits.behavior.sql mig-test:/tmp/t.sql
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000006001', 'pc-1@pc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000006002', 'pc-2@pc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000006003', 'pc-3@pc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000006004', 'pc-4@pc.test', '{}', 'authenticated', 'authenticated');

-- 0. A period reset (basic plan: 4,500) records what it granted as the peak.
UPDATE profiles SET subscription_credits = 4500, credits_reset_at = '2026-11-01T00:00:00Z'
 WHERE id = '00000000-0000-4000-8000-000000006001';
SELECT pg_temp.assert_eq('a reset seeds the period peak with the amount it granted',
  (SELECT peak_credits::text FROM plan_credit_periods WHERE user_id = '00000000-0000-4000-8000-000000006001'), '4500');
-- Spending moves the pool, never the period.
UPDATE profiles SET subscription_credits = 1000 WHERE id = '00000000-0000-4000-8000-000000006001';
SELECT pg_temp.assert_eq('spending does not touch the period peak',
  (SELECT peak_credits::text FROM plan_credit_periods WHERE user_id = '00000000-0000-4000-8000-000000006001'), '4500');

-- 1. The paid upgrade basic → pro adds the gap (23,000 − 4,500), not the full plan.
SELECT pg_temp.assert_eq('the paid upgrade grants the gap',
  (SELECT claimed::text || '/' || granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006001', 'in_pc_1', 4500, 23000, 18.50, 'pro')),
  'true/18500');
SELECT pg_temp.assert_eq('the gap is ADDED to what was left (1,000 + 18,500)',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000006001'), '19500');
SELECT pg_temp.assert_eq('the claim row records the credits actually granted',
  (SELECT type || '/' || credits_granted::text || '/' || tier FROM transactions WHERE stripe_transaction_id = 'in_pc_1'),
  'subscription/18500/pro');
SELECT pg_temp.assert_eq('the ledger row carries the gap and the balance after',
  (SELECT amount::text || '/' || balance_after::text FROM credit_transactions
    WHERE user_id = '00000000-0000-4000-8000-000000006001' AND description LIKE 'Plan upgrade to pro%'),
  '18500/19500');

-- 2. A replay of the same invoice (the webhook after the route, a redelivery) is a no-op.
SELECT pg_temp.assert_eq('a replayed invoice is not claimed again',
  (SELECT claimed::text || '/' || granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006001', 'in_pc_1', 4500, 23000, 18.50, 'pro')),
  'false/0');
SELECT pg_temp.assert_eq('a replay moves no credits',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000006001'), '19500');

-- 3. Down to basic and back up to pro in the SAME period: the second paid
--    upgrade grants nothing (the period already granted pro).
SELECT pg_temp.assert_eq('a downgrade notes the plan left; the peak stays at pro',
  (SELECT note_plan_credit_peak('00000000-0000-4000-8000-000000006001', 23000)::text), '23000');
SELECT pg_temp.assert_eq('the second upgrade in one period grants nothing',
  (SELECT claimed::text || '/' || granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006001', 'in_pc_2', 4500, 23000, 18.50, 'pro')),
  'true/0');
SELECT pg_temp.assert_eq('...and the pool is where it was',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000006001'), '19500');
-- Even with no note at all (the downgrade's webhook arrives late), the peak
-- recorded by the first upgrade holds.
SELECT pg_temp.assert_eq('the peak alone blocks the refill (third upgrade, no note)',
  (SELECT granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006001', 'in_pc_3', 4500, 23000, 18.50, 'pro')),
  '0');

-- 4. A move above the peak grants only the part above it (pro → business).
SELECT pg_temp.assert_eq('an upgrade above the peak grants only the part above it',
  (SELECT granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006001', 'in_pc_4', 23000, 52000, 30.00, 'business')),
  '29000');
SELECT pg_temp.assert_eq('the peak follows the paid plan',
  (SELECT peak_credits::text FROM plan_credit_periods WHERE user_id = '00000000-0000-4000-8000-000000006001'), '52000');

-- 5. A new period (the renewal SETs the plan and stamps the reset) starts
--    from what its reset granted, not from the old period's peak.
UPDATE profiles SET subscription_credits = 4500, credits_reset_at = '2026-12-01T00:00:00Z'
 WHERE id = '00000000-0000-4000-8000-000000006001';
SELECT pg_temp.assert_eq('the renewal re-seeds the peak',
  (SELECT peak_credits::text FROM plan_credit_periods WHERE user_id = '00000000-0000-4000-8000-000000006001'), '4500');
SELECT pg_temp.assert_eq('an upgrade in the new period grants its gap again',
  (SELECT granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006001', 'in_pc_5', 4500, 23000, 18.50, 'pro')),
  '18500');

-- 6. A period that began before this migration (no row): the plan left is
--    the floor; a row describing an earlier period counts as no peak.
UPDATE profiles SET subscription_credits = 11000 WHERE id = '00000000-0000-4000-8000-000000006002';
SELECT pg_temp.assert_eq('no row yet: the plan left is the floor',
  (SELECT granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006002', 'in_pc_6', 11000, 23000, 12.00, 'pro')),
  '12000');
UPDATE plan_credit_periods SET period_reset_at = '2020-01-01T00:00:00Z', peak_credits = 52000
 WHERE user_id = '00000000-0000-4000-8000-000000006002';
SELECT pg_temp.assert_eq('a stale row (an earlier period) is not this period''s peak',
  (SELECT granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006002', 'in_pc_7', 11000, 23000, 12.00, 'pro')),
  '12000');

-- 7. Bad input is refused, not clamped into a grant.
DO $$ BEGIN
  PERFORM grant_plan_change_credits('00000000-0000-4000-8000-000000006002', '', 0, 23000, 0, 'pro');
  RAISE EXCEPTION 'ASSERT FAIL: an empty invoice id was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'ASSERT FAIL%' THEN RAISE; END IF;
  RAISE NOTICE 'ok  an empty invoice id is refused';
END $$;

-- 8. A monthly <-> yearly switch restarts Stripe's billing period part-way
--    through. The period already paid out (pro, 23,000, partly spent): the
--    restart grants nothing, carries the peak, and stamps the reset.
UPDATE profiles SET subscription_credits = 23000, credits_reset_at = now() - interval '19 days'
 WHERE id = '00000000-0000-4000-8000-000000006003';
UPDATE profiles SET subscription_credits = 5000 WHERE id = '00000000-0000-4000-8000-000000006003';
SELECT pg_temp.assert_eq('monthly -> yearly: the restart carries the period''s peak',
  (SELECT restart_plan_credit_period('00000000-0000-4000-8000-000000006003', 23000)::text), '23000');
SELECT pg_temp.assert_eq('...and grants nothing (the pool is what was left)',
  (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000006003'), '5000');
SELECT pg_temp.assert_eq('...it stamps the reset at the switch',
  (SELECT (credits_reset_at = now())::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000006003'), 'true');
SELECT pg_temp.assert_eq('...and the new period''s peak is the carried one, not the pool',
  (SELECT peak_credits::text FROM plan_credit_periods pcp JOIN profiles p ON p.id = pcp.user_id
    WHERE pcp.user_id = '00000000-0000-4000-8000-000000006003' AND pcp.period_reset_at = p.credits_reset_at), '23000');
SELECT pg_temp.assert_eq('yearly -> monthly (switching back): still nothing',
  (SELECT restart_plan_credit_period('00000000-0000-4000-8000-000000006003', 23000)::text || '/' || subscription_credits::text
     FROM profiles WHERE id = '00000000-0000-4000-8000-000000006003'), '23000/5000');
SELECT pg_temp.assert_eq('a paid same-plan invoice after the switch grants nothing',
  (SELECT granted_credits::text
     FROM grant_plan_change_credits('00000000-0000-4000-8000-000000006003', 'in_pc_8', 23000, 23000, 120.00, 'pro')),
  '0');
-- The yearly plan's monthly grant: its first anchor is the restarted
-- period's start, which the stamp has already covered. Account 6004 is the
-- same yearly period with no restart stamp, where that anchor would grant.
INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end)
VALUES
  ('a0000000-0000-4000-8000-000000006003', '00000000-0000-4000-8000-000000006003', 'sub_pc_3', 'price_pc_pro_yearly', 'pro', 'active',
   date_trunc('second', now()) - interval '1 hour', date_trunc('second', now()) - interval '1 hour' + interval '1 year'),
  ('a0000000-0000-4000-8000-000000006004', '00000000-0000-4000-8000-000000006004', 'sub_pc_4', 'price_pc_pro_yearly', 'pro', 'active',
   date_trunc('second', now()) - interval '1 hour', date_trunc('second', now()) - interval '1 hour' + interval '1 year');
UPDATE profiles SET subscription_credits = 5000, credits_reset_at = now() - interval '19 days'
 WHERE id = '00000000-0000-4000-8000-000000006004';
SELECT pg_temp.assert_eq('after the restart, the yearly grant refuses the restarted period''s first anchor',
  (SELECT grant_yearly_plan_monthly_credits('00000000-0000-4000-8000-000000006003', 'a0000000-0000-4000-8000-000000006003',
     'price_pc_pro_yearly', date_trunc('second', now()) - interval '1 hour', date_trunc('second', now()) - interval '1 hour', 23000)::text),
  'false');
SELECT pg_temp.assert_eq('control: without the stamp, that anchor would have granted',
  (SELECT grant_yearly_plan_monthly_credits('00000000-0000-4000-8000-000000006004', 'a0000000-0000-4000-8000-000000006004',
     'price_pc_pro_yearly', date_trunc('second', now()) - interval '1 hour', date_trunc('second', now()) - interval '1 hour', 23000)::text),
  'true');

-- 9. No browser role can call the functions or read the table.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000006002","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000006002';
DO $$ BEGIN
  PERFORM grant_plan_change_credits('00000000-0000-4000-8000-000000006002', 'in_pc_x', 0, 999999, 0, 'pro');
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could EXECUTE grant_plan_change_credits';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot EXECUTE grant_plan_change_credits';
END $$;
DO $$ BEGIN
  PERFORM note_plan_credit_peak('00000000-0000-4000-8000-000000006002', 0);
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could EXECUTE note_plan_credit_peak';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot EXECUTE note_plan_credit_peak';
END $$;
DO $$ BEGIN
  PERFORM restart_plan_credit_period('00000000-0000-4000-8000-000000006002', 0);
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could EXECUTE restart_plan_credit_period';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot EXECUTE restart_plan_credit_period';
END $$;
DO $$ BEGIN
  PERFORM count(*) FROM plan_credit_periods;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could SELECT plan_credit_periods';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot SELECT plan_credit_periods';
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM grant_plan_change_credits('00000000-0000-4000-8000-000000006002', 'in_pc_y', 0, 999999, 0, 'pro');
  RAISE EXCEPTION 'ASSERT FAIL: anon could EXECUTE grant_plan_change_credits';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon cannot EXECUTE grant_plan_change_credits';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
