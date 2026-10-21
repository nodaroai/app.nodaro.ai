-- ============================================================================
-- Behavioral proof: migration 551 — commit_credits_metered, the settle that
-- collects a metered overrun beyond the hold from the payer's balance and logs
-- what it cannot collect.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000548001 upward).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/commit-credits-metered.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
--
-- The numbers are the plan's: a hold of 368 (H1), an actual of 917 (the Fable
-- direct fallback: 1.66507 USD -> 833 base -> ceil(916.3) = 917). Every
-- balance below is set so the figure AFTER the 368 reserve is the plan's
-- "sub 1000" / "sub 100" — the reserve debits first.
--
--   1   personal, enough balance: the whole overrun is collected.
--   1b  personal, split pools: subscription first, then top-up.
--   2   personal, short: collect what is there, log the rest.
--   3   actual <= hold: byte-for-byte today's commit_credits (twin rows).
--   4   web-free-mode row: draws the free pool only, never the top-up.
--   5   deployment payer, enforced allowance: capped by the allowance headroom.
--   5b  deployment payer, allowance NOT enforced: the payer's pools only.
--   6   workspace payer: identical to commit_credits(log, 917) (twin workspaces).
--   7   external-wallet row: settled at the hold, overrun logged, trigger quiet.
--   8   commit_credits(log, 917) itself is unchanged: no pool movement.
--   9   grants: anon / authenticated cannot execute; service_role can.
--   10  a settled row is refused (no double collection); NULL / negative refused.
--   11  the app allowance follows the collection in the sign reserve stamped:
--       a free-tier flow run earns it, a free-tier app run consumes it
--       (floored at 0).
--   12  a COLLECTED overrun writes one credit_transactions 'usage' line for the
--       collected credits (credits only) on the payer; nothing collected, or a
--       workspace row, writes none.
-- ============================================================================
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(p_label text, p_actual text, p_expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERT FAIL: % — expected %, got %', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'ok %', p_label;
END $$;

CREATE FUNCTION pg_temp.prof(p_user uuid, p_col text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SELECT %I::text FROM profiles WHERE id = $1', p_col) INTO v USING p_user;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.anomalies(p_log uuid) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::integer FROM credit_anomalies WHERE usage_log_id = p_log;
$$;

-- The overrun ledger lines (12) a user's account carries: amount/credit_type/balance_after.
CREATE FUNCTION pg_temp.overrun_lines(p_user uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(amount || '/' || credit_type || '/' || balance_after, ',' ORDER BY id), '')
    FROM credit_transactions WHERE user_id = p_user AND source = 'usage' AND description LIKE '% — usage above the hold';
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_app_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000548001', 'ccm-1@ccm.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548002', 'ccm-2@ccm.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548003', 'ccm-3a@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548004', 'ccm-3b@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548005', 'ccm-4@ccm.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548006', 'ccm-5-payer@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548007', 'ccm-5-user@ccm.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548008', 'ccm-5b-user@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548009', 'ccm-5b-payer@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548010', 'ccm-6-owner@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548011', 'ccm-6-member@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548012', 'ccm-7-payer@ccm.test', '{"sso":"sai","sso_subject":"ccm-payer"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548013', 'ccm-7-user@ccm.test',  '{"sso":"sai","sso_subject":"ccm-user"}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548014', 'ccm-8@ccm.test',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548015', 'ccm-1b@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548016', 'ccm-10@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548017', 'ccm-11a@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548018', 'ccm-11b@ccm.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000548019', 'ccm-11c@ccm.test', '{}', 'authenticated', 'authenticated');

-- A paid tier everywhere except case 4, so `allowance_delta` is 0 and the
-- app-allowance column stays out of the arithmetic.
UPDATE profiles SET tier = 'business', subscription_tier = 'business',
                    topup_credits = 0, daily_spent_credits = 0, lifetime_topup_credits = 0
WHERE id::text LIKE '00000000-0000-4000-8000-000000548%';
UPDATE profiles SET subscription_credits = 1368 WHERE id = '00000000-0000-4000-8000-000000548001';
UPDATE profiles SET subscription_credits = 468  WHERE id = '00000000-0000-4000-8000-000000548002';
UPDATE profiles SET subscription_credits = 1000 WHERE id IN ('00000000-0000-4000-8000-000000548003', '00000000-0000-4000-8000-000000548004');
UPDATE profiles SET subscription_credits = 1368 WHERE id IN ('00000000-0000-4000-8000-000000548006', '00000000-0000-4000-8000-000000548009',
                                                             '00000000-0000-4000-8000-000000548012', '00000000-0000-4000-8000-000000548014');
UPDATE profiles SET subscription_credits = 468, topup_credits = 1000 WHERE id = '00000000-0000-4000-8000-000000548015';
UPDATE profiles SET subscription_credits = 2000 WHERE id = '00000000-0000-4000-8000-000000548016';
-- Case 4: a payg free-tier account in web-free-mode (lifetime top-ups > 0),
-- free pool exactly the hold, top-up 500 that web spending may not touch.
UPDATE profiles SET tier = 'free', subscription_tier = 'free', subscription_credits = 368,
                    topup_credits = 500, lifetime_topup_credits = 500
WHERE id = '00000000-0000-4000-8000-000000548005';
-- Case 11: genuinely-free accounts (never purchased), so reserve stamps a
-- non-zero allowance_delta. 11b's allowance is exactly the hold.
UPDATE profiles SET tier = 'free', subscription_tier = 'free', subscription_credits = 1368,
                    topup_credits = 0, lifetime_topup_credits = 0, app_credits_allowance = 0
WHERE id = '00000000-0000-4000-8000-000000548017';
UPDATE profiles SET tier = 'free', subscription_tier = 'free', subscription_credits = 1368,
                    topup_credits = 0, lifetime_topup_credits = 0, app_credits_allowance = 368
WHERE id = '00000000-0000-4000-8000-000000548018';
UPDATE profiles SET tier = 'free', subscription_tier = 'free', subscription_credits = 1368,
                    topup_credits = 0, lifetime_topup_credits = 0, app_credits_allowance = 1000
WHERE id = '00000000-0000-4000-8000-000000548019';

-- ---------------------------------------------------------------------------
-- 1. Personal, enough balance: charged 917, collected 549, sub 1000 -> 451.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid; r jsonb;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000548001', 368, NULL, 'llm-chat:claude-fable-5');
  PERFORM pg_temp.assert_eq('1a the reserve left sub 1000', pg_temp.prof('00000000-0000-4000-8000-000000548001', 'subscription_credits'), '1000');
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('1b result', r::text,
    '{"payer": "personal", "charged": 917, "shortfall": 0, "collected_over_hold": 549}');
  PERFORM pg_temp.assert_eq('1c sub 451', pg_temp.prof('00000000-0000-4000-8000-000000548001', 'subscription_credits'), '451');
  PERFORM pg_temp.assert_eq('1d topup untouched', pg_temp.prof('00000000-0000-4000-8000-000000548001', 'topup_credits'), '0');
  PERFORM pg_temp.assert_eq('1e daily spent 368 + 549', pg_temp.prof('00000000-0000-4000-8000-000000548001', 'daily_spent_credits'), '917');
  PERFORM pg_temp.assert_eq('1f row committed at 917',
    (SELECT status || ':' || credits_charged FROM usage_logs WHERE id = v_log), 'committed:917');
  PERFORM pg_temp.assert_eq('1g metadata.overrun',
    (SELECT (metadata->'overrun')::text FROM usage_logs WHERE id = v_log),
    '{"from_sub": 549, "collected": 549, "shortfall": 0, "from_topup": 0}');
  PERFORM pg_temp.assert_eq('1h no anomaly', pg_temp.anomalies(v_log)::text, '0');
  PERFORM pg_temp.assert_eq('12a the collected 549 is one usage line on the payer (credits only)',
    pg_temp.overrun_lines('00000000-0000-4000-8000-000000548001'), '-549/subscription/451');
  PERFORM pg_temp.assert_eq('12b its description is the charge id, no job named (none given)',
    (SELECT description FROM credit_transactions WHERE user_id = '00000000-0000-4000-8000-000000548001' AND description LIKE '% — usage above the hold'),
    'llm-chat:claude-fable-5 — usage above the hold');
END $$;

-- ---------------------------------------------------------------------------
-- 1b. Split pools: sub 100 + top-up 1000 after the hold -> 100 from sub,
--     449 from top-up.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid; r jsonb;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000548015', 368, NULL, 'llm-chat:claude-fable-5');
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('1b-a collected 549', r->>'collected_over_hold', '549');
  PERFORM pg_temp.assert_eq('1b-b sub drained first', pg_temp.prof('00000000-0000-4000-8000-000000548015', 'subscription_credits'), '0');
  PERFORM pg_temp.assert_eq('1b-c then top-up', pg_temp.prof('00000000-0000-4000-8000-000000548015', 'topup_credits'), '551');
  PERFORM pg_temp.assert_eq('1b-d metadata split',
    (SELECT (metadata->'overrun'->>'from_sub') || '/' || (metadata->'overrun'->>'from_topup') FROM usage_logs WHERE id = v_log), '100/449');
  PERFORM pg_temp.assert_eq('12c a split collection is one mixed line',
    pg_temp.overrun_lines('00000000-0000-4000-8000-000000548015'), '-549/mixed/551');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Personal, short: sub 100 after the hold -> charged 468, collected 100,
--    shortfall 449 logged as one uncollected_overrun anomaly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid; r jsonb; a credit_anomalies%ROWTYPE;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000548002', 368, NULL, 'llm-chat:claude-fable-5');
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('2a result', r::text,
    '{"payer": "personal", "charged": 468, "shortfall": 449, "collected_over_hold": 100}');
  PERFORM pg_temp.assert_eq('2b sub 0', pg_temp.prof('00000000-0000-4000-8000-000000548002', 'subscription_credits'), '0');
  PERFORM pg_temp.assert_eq('2c row charged 468',
    (SELECT credits_charged::text FROM usage_logs WHERE id = v_log), '468');
  PERFORM pg_temp.assert_eq('2d exactly one anomaly', pg_temp.anomalies(v_log)::text, '1');
  SELECT * INTO a FROM credit_anomalies WHERE usage_log_id = v_log;
  PERFORM pg_temp.assert_eq('2e anomaly shape',
    a.anomaly_type || ' est=' || a.credits_estimated || ' act=' || a.credits_actual || ' diff=' || a.diff
      || ' model=' || a.model_identifier || ' user=' || a.user_id,
    'uncollected_overrun est=368 act=917 diff=449 model=llm-chat:claude-fable-5 user=00000000-0000-4000-8000-000000548002');
END $$;

-- ---------------------------------------------------------------------------
-- 3. actual <= hold: identical to commit_credits(log, 27). Twin users, twin
--    reserves; one settled each way.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_a uuid; v_b uuid; r jsonb;
BEGIN
  v_a := reserve_credits('00000000-0000-4000-8000-000000548003', 368, NULL, 'llm-chat:claude-fable-5');
  v_b := reserve_credits('00000000-0000-4000-8000-000000548004', 368, NULL, 'llm-chat:claude-fable-5');
  PERFORM commit_credits(v_a, 27);
  r := commit_credits_metered(v_b, 27);
  PERFORM pg_temp.assert_eq('3a result', r::text,
    '{"payer": "personal", "charged": 27, "shortfall": 0, "collected_over_hold": 0}');
  PERFORM pg_temp.assert_eq('3b refund 341 to the pools, both ways',
    pg_temp.prof('00000000-0000-4000-8000-000000548003', 'subscription_credits') || '/' ||
    pg_temp.prof('00000000-0000-4000-8000-000000548004', 'subscription_credits'), '973/973');
  PERFORM pg_temp.assert_eq('3c daily spent identical',
    pg_temp.prof('00000000-0000-4000-8000-000000548003', 'daily_spent_credits') || '/' ||
    pg_temp.prof('00000000-0000-4000-8000-000000548004', 'daily_spent_credits'), '27/27');
  PERFORM pg_temp.assert_eq('3d rows identical (status, charged, metadata)',
    (SELECT status || ':' || credits_charged || ':' || metadata::text FROM usage_logs WHERE id = v_a),
    (SELECT status || ':' || credits_charged || ':' || metadata::text FROM usage_logs WHERE id = v_b));
  PERFORM pg_temp.assert_eq('12d nothing collected (actual <= hold): no line',
    pg_temp.overrun_lines('00000000-0000-4000-8000-000000548004'), '');
END $$;

-- ---------------------------------------------------------------------------
-- 4. web-free-mode: the free pool is empty after the hold, the top-up 500 is
--    off limits -> collected 0, shortfall 549.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid; r jsonb;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000548005', 368, NULL, 'llm-chat:claude-fable-5',
                           p_web_free_mode => true);
  PERFORM pg_temp.assert_eq('4a the reserve stamped web_free_mode',
    (SELECT metadata->>'web_free_mode' FROM usage_logs WHERE id = v_log), 'true');
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('4b result', r::text,
    '{"payer": "personal", "charged": 368, "shortfall": 549, "collected_over_hold": 0}');
  PERFORM pg_temp.assert_eq('4c top-up untouched', pg_temp.prof('00000000-0000-4000-8000-000000548005', 'topup_credits'), '500');
  PERFORM pg_temp.assert_eq('4d shortfall logged', (SELECT diff::text FROM credit_anomalies WHERE usage_log_id = v_log), '549');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Deployment payer, enforced allowance: granted 418, so the headroom after
--    the hold settles is exactly 50. Payer has 1000 -> collected 50, allowance
--    spent 368 + 50, shortfall 499.
-- ---------------------------------------------------------------------------
INSERT INTO deployment_payer_settings (id, payer_user_id, default_allowance_credits)
VALUES (true, '00000000-0000-4000-8000-000000548006', 418)
ON CONFLICT (id) DO UPDATE SET payer_user_id = excluded.payer_user_id,
                               default_allowance_credits = excluded.default_allowance_credits;

DO $$
DECLARE v_log uuid; r jsonb;
BEGIN
  v_log := reserve_credits(
    p_user_id := '00000000-0000-4000-8000-000000548006', p_credits := 368, p_job_id := NULL,
    p_model_identifier := 'llm-chat:claude-fable-5',
    p_on_behalf_of := '00000000-0000-4000-8000-000000548007', p_enforce_allowance := TRUE);
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('5a result', r::text,
    '{"payer": "deployment", "charged": 418, "shortfall": 499, "collected_over_hold": 50}');
  PERFORM pg_temp.assert_eq('5b payer paid 368 + 50', pg_temp.prof('00000000-0000-4000-8000-000000548006', 'subscription_credits'), '950');
  PERFORM pg_temp.assert_eq('5c allowance spent 418, reserved 0',
    (SELECT spent_credits || '/' || reserved_credits || '/' || granted_credits FROM deployment_user_allowances
      WHERE user_id = '00000000-0000-4000-8000-000000548007'), '418/0/418');
  PERFORM pg_temp.assert_eq('5d shortfall logged against the payer',
    (SELECT diff || ' ' || user_id FROM credit_anomalies WHERE usage_log_id = v_log),
    '499 00000000-0000-4000-8000-000000548006');
  PERFORM pg_temp.assert_eq('12e the 50 collected is one line on the PAYER',
    pg_temp.overrun_lines('00000000-0000-4000-8000-000000548006'), '-50/subscription/950');
  PERFORM pg_temp.assert_eq('5e requester untouched', pg_temp.prof('00000000-0000-4000-8000-000000548007', 'subscription_credits'),
    (SELECT subscription_credits::text FROM profiles WHERE id = '00000000-0000-4000-8000-000000548008'));
END $$;

-- 5b. Deployment payer WITHOUT enforcement: the payer's pools are the only cap.
DO $$
DECLARE v_log uuid; r jsonb;
BEGIN
  v_log := reserve_credits(
    p_user_id := '00000000-0000-4000-8000-000000548009', p_credits := 368, p_job_id := NULL,
    p_model_identifier := 'llm-chat:claude-fable-5',
    p_on_behalf_of := '00000000-0000-4000-8000-000000548008');
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('5b-a result', r::text,
    '{"payer": "deployment", "charged": 917, "shortfall": 0, "collected_over_hold": 549}');
  PERFORM pg_temp.assert_eq('5b-b payer sub 451', pg_temp.prof('00000000-0000-4000-8000-000000548009', 'subscription_credits'), '451');
  PERFORM pg_temp.assert_eq('5b-c no allowance row was created',
    (SELECT count(*)::text FROM deployment_user_allowances WHERE user_id = '00000000-0000-4000-8000-000000548008'), '0');
END $$;

-- ---------------------------------------------------------------------------
-- 6. Workspace payer: twin workspaces, 500 allocated each, a 368 hold each.
--    commit_credits(A, 917) and commit_credits_metered(B, 917) must leave the
--    same budget, the same variance row and the same usage_logs row.
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES
  ('a0000000-0000-4000-8000-000000548001', 'ccm-org', 'CCM Org', 'school',
   '00000000-0000-4000-8000-000000548010', 'active', '{}');
INSERT INTO public.workspaces (id, org_id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000548001', 'a0000000-0000-4000-8000-000000548001', 'CCM WS A', 'ccm-ws-a'),
  ('b0000000-0000-4000-8000-000000548002', 'a0000000-0000-4000-8000-000000548001', 'CCM WS B', 'ccm-ws-b');
INSERT INTO public.organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000548001', '00000000-0000-4000-8000-000000548010', 'owner', 'active'),
  ('a0000000-0000-4000-8000-000000548001', '00000000-0000-4000-8000-000000548011', 'member', 'active');
INSERT INTO public.workspace_members (workspace_id, org_id, user_id, role, status) VALUES
  ('b0000000-0000-4000-8000-000000548001', 'a0000000-0000-4000-8000-000000548001', '00000000-0000-4000-8000-000000548011', 'member', 'active'),
  ('b0000000-0000-4000-8000-000000548002', 'a0000000-0000-4000-8000-000000548001', '00000000-0000-4000-8000-000000548011', 'member', 'active');
SELECT public.grant_org_credits_idempotent('a0000000-0000-4000-8000-000000548001', 1000, 'cs_ccm_org', 'org_purchase', 25.00);
SELECT public.allocate_workspace_credits('a0000000-0000-4000-8000-000000548001',
  'b0000000-0000-4000-8000-000000548001', 500, '00000000-0000-4000-8000-000000548010');
SELECT public.allocate_workspace_credits('a0000000-0000-4000-8000-000000548001',
  'b0000000-0000-4000-8000-000000548002', 500, '00000000-0000-4000-8000-000000548010');

DO $$
DECLARE v_a uuid; v_b uuid; r jsonb;
BEGIN
  v_a := reserve_credits('00000000-0000-4000-8000-000000548011', 368, NULL, 'llm-chat:claude-fable-5',
                         p_workspace_id => 'b0000000-0000-4000-8000-000000548001');
  v_b := reserve_credits('00000000-0000-4000-8000-000000548011', 368, NULL, 'llm-chat:claude-fable-5',
                         p_workspace_id => 'b0000000-0000-4000-8000-000000548002');
  PERFORM commit_credits(v_a, 917);
  r := commit_credits_metered(v_b, 917);
  PERFORM pg_temp.assert_eq('6a result: charged is what the row records, the budget took 132 over the hold, 417 absorbed',
    r::text, '{"payer": "workspace", "charged": 917, "shortfall": 417, "collected_over_hold": 132}');
  PERFORM pg_temp.assert_eq('6b budgets identical',
    (SELECT allocated_credits || '/' || reserved_credits || '/' || spent_credits FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000548001'),
    (SELECT allocated_credits || '/' || reserved_credits || '/' || spent_credits FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000548002'));
  PERFORM pg_temp.assert_eq('6c budget spent up to the headroom',
    (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000548002'), '500');
  PERFORM pg_temp.assert_eq('6d one org_usage_variance row each, same amount',
    (SELECT string_agg(amount::text, ',' ORDER BY workspace_id) FROM credit_transactions
      WHERE source = 'org_usage_variance' AND workspace_id IN ('b0000000-0000-4000-8000-000000548001', 'b0000000-0000-4000-8000-000000548002')),
    '417,417');
  PERFORM pg_temp.assert_eq('6e rows identical (status, charged, metadata minus the workspace id)',
    (SELECT status || ':' || credits_charged || ':' || (metadata - 'payer')::text FROM usage_logs WHERE id = v_a),
    (SELECT status || ':' || credits_charged || ':' || (metadata - 'payer')::text FROM usage_logs WHERE id = v_b));
  PERFORM pg_temp.assert_eq('6f no credit_anomalies row: org_usage_variance is the workspace record',
    pg_temp.anomalies(v_b)::text, '0');
  PERFORM pg_temp.assert_eq('12f a workspace row writes no overrun line (org_usage_variance is its record)',
    pg_temp.overrun_lines('00000000-0000-4000-8000-000000548011'), '');
  PERFORM pg_temp.assert_eq('6g member personal balance untouched',
    pg_temp.prof('00000000-0000-4000-8000-000000548011', 'subscription_credits'),
    pg_temp.prof('00000000-0000-4000-8000-000000548010', 'subscription_credits'));
END $$;

-- ---------------------------------------------------------------------------
-- 7. External-wallet row: settled at the hold, the overrun is logged, and the
--    434 capture trigger (which raises on credits_charged > reserved) is quiet.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid; r jsonb;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000548012', 368, NULL, 'llm-chat:claude-fable-5',
                           p_on_behalf_of => '00000000-0000-4000-8000-000000548013');
  PERFORM prepare_external_wallet(v_log, '00000000-0000-4000-8000-000000548013', '00000000-0000-4000-8000-000000548012', 'sai');
  PERFORM authorize_external_wallet(v_log);
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('7a result', r::text,
    '{"payer": "external_wallet", "charged": 368, "shortfall": 549, "collected_over_hold": 0}');
  PERFORM pg_temp.assert_eq('7b the wallet journal holds the hold, never more',
    (SELECT actual_credits::text FROM external_wallet_operations WHERE usage_log_id = v_log), '368');
  PERFORM pg_temp.assert_eq('7c local pools did not move past the hold',
    pg_temp.prof('00000000-0000-4000-8000-000000548012', 'subscription_credits'), '1000');
  PERFORM pg_temp.assert_eq('7d shortfall logged', (SELECT diff::text FROM credit_anomalies WHERE usage_log_id = v_log), '549');
  PERFORM pg_temp.assert_eq('7e row committed at the hold',
    (SELECT status || ':' || credits_charged FROM usage_logs WHERE id = v_log), 'committed:368');
END $$;

-- ---------------------------------------------------------------------------
-- 8. commit_credits itself is untouched: (log, 917) on a personal row records
--    917 and moves no pool.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000548014', 368, NULL, 'llm-chat:claude-fable-5');
  PERFORM commit_credits(v_log, 917);
  PERFORM pg_temp.assert_eq('8a commit_credits records 917',
    (SELECT status || ':' || credits_charged FROM usage_logs WHERE id = v_log), 'committed:917');
  PERFORM pg_temp.assert_eq('8b and moves no pool', pg_temp.prof('00000000-0000-4000-8000-000000548014', 'subscription_credits'), '1000');
  PERFORM pg_temp.assert_eq('8c and has no metadata.overrun',
    (SELECT (metadata ? 'overrun')::text FROM usage_logs WHERE id = v_log), 'false');
  PERFORM pg_temp.assert_eq('8d commit_credits has exactly one signature, (uuid, integer)',
    (SELECT string_agg(pg_get_function_identity_arguments(oid), ' | ') FROM pg_proc
      WHERE proname = 'commit_credits' AND pronamespace = 'public'::regnamespace),
    'p_usage_log_id uuid, p_actual_credits integer');
END $$;

-- ---------------------------------------------------------------------------
-- 9. Grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_eq('9a anon cannot execute',
  has_function_privilege('anon', 'public.commit_credits_metered(uuid,integer)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('9b authenticated cannot execute',
  has_function_privilege('authenticated', 'public.commit_credits_metered(uuid,integer)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('9c service_role can execute',
  has_function_privilege('service_role', 'public.commit_credits_metered(uuid,integer)', 'EXECUTE')::text, 'true');
SELECT pg_temp.assert_eq('9d security definer with a pinned search_path',
  (SELECT prosecdef::text || ' ' || array_to_string(proconfig, ',') FROM pg_proc
    WHERE proname = 'commit_credits_metered' AND pronamespace = 'public'::regnamespace),
  'true search_path=public, pg_temp');

-- ---------------------------------------------------------------------------
-- 10. A settled row cannot be collected twice; NULL / negative are refused.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid; v_sub text; v_msg text;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000548016', 368, NULL, 'llm-chat:claude-fable-5');
  PERFORM commit_credits_metered(v_log, 917);
  v_sub := pg_temp.prof('00000000-0000-4000-8000-000000548016', 'subscription_credits');
  PERFORM pg_temp.assert_eq('10a first settle collected', v_sub, '1083');
  BEGIN
    PERFORM commit_credits_metered(v_log, 917);
    v_msg := 'no error';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM pg_temp.assert_eq('10b a replay is refused', v_msg, 'Usage log not found');
  PERFORM pg_temp.assert_eq('10c and collects nothing', pg_temp.prof('00000000-0000-4000-8000-000000548016', 'subscription_credits'), v_sub);

  v_log := reserve_credits('00000000-0000-4000-8000-000000548016', 10, NULL, 'llm-chat:claude-fable-5');
  BEGIN
    PERFORM commit_credits_metered(v_log, NULL);
    v_msg := 'no error';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM pg_temp.assert_eq('10d NULL actual is refused', left(v_msg, 24), 'METERED_ACTUAL_REQUIRED:');
  BEGIN
    PERFORM commit_credits_metered(v_log, -1);
    v_msg := 'no error';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM pg_temp.assert_eq('10e negative actual is refused', left(v_msg, 24), 'METERED_ACTUAL_REQUIRED:');
  PERFORM pg_temp.assert_eq('10f the refused row is still reserved',
    (SELECT status FROM usage_logs WHERE id = v_log), 'reserved');
END $$;

-- ---------------------------------------------------------------------------
-- 11. App allowance.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_log uuid; r jsonb;
BEGIN
  -- 11a. Flow run, free tier: reserve earned 368; the overrun earns 549 more.
  v_log := reserve_credits('00000000-0000-4000-8000-000000548017', 368, NULL, 'llm-chat:claude-fable-5');
  PERFORM pg_temp.assert_eq('11a-1 reserve stamped an earn',
    (SELECT metadata->>'allowance_delta' FROM usage_logs WHERE id = v_log), '368');
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('11a-2 collected 549', r->>'collected_over_hold', '549');
  PERFORM pg_temp.assert_eq('11a-3 allowance earned 368 + 549',
    pg_temp.prof('00000000-0000-4000-8000-000000548017', 'app_credits_allowance'), '917');

  -- 11b. App run, free tier: reserve consumed the whole 368 allowance; the
  --      overrun consumes the rest, floored at 0 (never -549).
  v_log := reserve_credits('00000000-0000-4000-8000-000000548018', 368, NULL, 'llm-chat:claude-fable-5',
                           p_is_app_run => true);
  PERFORM pg_temp.assert_eq('11b-1 reserve stamped a consume',
    (SELECT metadata->>'allowance_delta' FROM usage_logs WHERE id = v_log), '-368');
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('11b-2 collected 549 from the pools', r->>'collected_over_hold', '549');
  PERFORM pg_temp.assert_eq('11b-3 sub 1000 -> 451', pg_temp.prof('00000000-0000-4000-8000-000000548018', 'subscription_credits'), '451');
  PERFORM pg_temp.assert_eq('11b-4 allowance floored at 0',
    pg_temp.prof('00000000-0000-4000-8000-000000548018', 'app_credits_allowance'), '0');

  -- 11c. App run with allowance to spare: 1000 - 368 - 549 = 83.
  v_log := reserve_credits('00000000-0000-4000-8000-000000548019', 368, NULL, 'llm-chat:claude-fable-5',
                           p_is_app_run => true);
  r := commit_credits_metered(v_log, 917);
  PERFORM pg_temp.assert_eq('11c the overrun consumes allowance like the hold did',
    pg_temp.prof('00000000-0000-4000-8000-000000548019', 'app_credits_allowance'), '83');
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
