-- ============================================================================
-- Behavioral proof: the P15 usage-reporting readers (migration 369) read
-- exactly what the payer-aware reserve/commit/refund (351) writes.
--
-- Runs AFTER the whole migration chain, as `postgres`, inside one transaction
-- that rolls back. Its own uuid range (…-000000000931 upward) so it can never
-- collide with the sibling proofs (billing uses …0501+).
--
-- What it pins:
--   * refunded runs vanish from every reader; settled vs in-flight credits
--     split exactly; a metered overrun becomes a platform-absorbed variance
--     line that no member row ever carries;
--   * day buckets follow the requested IANA tz; the window helper refuses a
--     bad tz / an inverted or oversized range with stable RAISE prefixes;
--   * keyset paging is stable across a tied timestamp; p_limit clamps [1,1000];
--   * a deleted member takes their usage rows but NOT the platform-absorbed
--     line (025: credit_transactions.user_id is ON DELETE SET NULL);
--   * deployment-payer and personal rows are invisible to org/workspace scope;
--   * the four functions are STABLE, service-role only, pin pg_temp, and
--     return no cost/usd column.
--
-- Run locally:
--   docker run -d --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/orgs-usage.behavior.sql mig-test:/tmp/t.sql
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
-- owner (931) owns the school. A (932) uncapped member. B (933) capped 50.
-- outsider (934) belongs to nothing (personal + deployment-payer sanity).
-- C (935) does ONLY the settled/in-flight pair, D (936) ONLY the refund pair,
-- E (937) ONLY the model-key pair — one runner per scenario so a member
-- grouping isolates each without a shared window contaminating the sums.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000931', 'usage-owner@example.com'),
  ('00000000-0000-4000-8000-000000000932', 'usage-a@example.com'),
  ('00000000-0000-4000-8000-000000000933', 'usage-b@example.com'),
  ('00000000-0000-4000-8000-000000000934', 'usage-outsider@example.com'),
  ('00000000-0000-4000-8000-000000000935', 'usage-c@example.com'),
  ('00000000-0000-4000-8000-000000000936', 'usage-d@example.com'),
  ('00000000-0000-4000-8000-000000000937', 'usage-e@example.com'),
  ('00000000-0000-4000-8000-000000000938', 'usage-f@example.com');

INSERT INTO organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES
  ('a0000000-0000-4000-8000-000000000931', 'usage-org', 'Usage School', 'school',
   '00000000-0000-4000-8000-000000000931', 'active', '{}'::jsonb);

INSERT INTO workspaces (id, org_id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', 'Live WS', 'usage-live'),
  ('b0000000-0000-4000-8000-000000000932', 'a0000000-0000-4000-8000-000000000931', 'Archived WS', 'usage-arch');

INSERT INTO organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000931', 'owner',  'active'),
  ('a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000932', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000933', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000935', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000936', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000937', 'member', 'active'),
  ('a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000938', 'member', 'active');

INSERT INTO workspace_members (workspace_id, org_id, user_id, role, status, credit_cap) VALUES
  ('b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000932', 'member', 'active', NULL),
  ('b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000933', 'member', 'active', 50),
  ('b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000935', 'member', 'active', NULL),
  ('b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000936', 'member', 'active', NULL),
  ('b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000937', 'member', 'active', NULL),
  ('b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000938', 'member', 'active', NULL),
  ('b0000000-0000-4000-8000-000000000932', 'a0000000-0000-4000-8000-000000000931', '00000000-0000-4000-8000-000000000932', 'member', 'active', NULL);

UPDATE profiles SET subscription_credits = 1000, topup_credits = 0, daily_spent_credits = 0
WHERE id = '00000000-0000-4000-8000-000000000934';

-- --------------------------------------------------------- budget + runs
SELECT grant_org_credits_idempotent('a0000000-0000-4000-8000-000000000931', 200000, 'cs_usage_931', 'org_purchase', 100.00);

-- The overrun FIRST, on a fresh 30-credit budget, so its variance is exactly
-- 45 - min(45, 30) = 15 (behavior #4). A (932) is the runner (behavior #13).
SELECT allocate_workspace_credits('a0000000-0000-4000-8000-000000000931', 'b0000000-0000-4000-8000-000000000931', 30, '00000000-0000-4000-8000-000000000931');
DO $$
DECLARE v_log UUID;
BEGIN
  v_log := reserve_credits('00000000-0000-4000-8000-000000000932', 20, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931');
  PERFORM commit_credits(v_log, 45);   -- metered actual 45 >> headroom 30
  -- Cross-check the split at the moment of the overrun, before any other run
  -- adds to spent: 30 hit the budget (headroom), 15 became the variance line.
  PERFORM pg_temp.assert_eq('#4 overrun clamps budget spend to headroom (30)',
    (SELECT spent_credits::text FROM workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000000931'), '30');
  PERFORM pg_temp.assert_eq('#4 the log kept the true actual (45)',
    (SELECT credits_charged::text FROM usage_logs WHERE id = v_log), '45');
END $$;

-- Now open the budget wide for every other run on the live workspace.
SELECT allocate_workspace_credits('a0000000-0000-4000-8000-000000000931', 'b0000000-0000-4000-8000-000000000931', 100000, '00000000-0000-4000-8000-000000000931');

-- C (935): exactly one in-flight (20, uncommitted) + one settled (reserve 10, commit 7).
DO $$
BEGIN
  PERFORM reserve_credits('00000000-0000-4000-8000-000000000935', 20, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931');
  PERFORM commit_credits(
    reserve_credits('00000000-0000-4000-8000-000000000935', 10, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931'), 7);
END $$;

-- B (933, capped 50): one committed run of 8.
DO $$
BEGIN
  PERFORM commit_credits(
    reserve_credits('00000000-0000-4000-8000-000000000933', 8, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931'), 8);
END $$;

-- E (937): the model-key pair — 'flux-2-pro' and a NULL-model run (action 'generate').
DO $$
BEGIN
  PERFORM commit_credits(
    reserve_credits('00000000-0000-4000-8000-000000000937', 6, NULL, 'flux-2-pro', NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931'), 6);
  PERFORM commit_credits(
    reserve_credits('00000000-0000-4000-8000-000000000937', 6, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931'), 6);
END $$;

-- F (938): exactly one APP run (7th arg p_is_app_run = TRUE) — pins app_run_count / is_app_run.
DO $$
BEGIN
  PERFORM commit_credits(
    reserve_credits('00000000-0000-4000-8000-000000000938', 4, NULL, NULL, NULL, NULL, TRUE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931'), 4);
END $$;

-- Archived workspace (932): A runs one committed 30, THEN we archive it.
DO $$
BEGIN
  PERFORM allocate_workspace_credits('a0000000-0000-4000-8000-000000000931', 'b0000000-0000-4000-8000-000000000932', 1000, '00000000-0000-4000-8000-000000000931');
  PERFORM commit_credits(
    reserve_credits('00000000-0000-4000-8000-000000000932', 30, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000932'), 30);
END $$;
UPDATE workspaces SET archived_at = now() WHERE id = 'b0000000-0000-4000-8000-000000000932';

-- outsider (934): a purely personal run (no workspace) — behavior #16.
DO $$
BEGIN
  PERFORM reserve_credits('00000000-0000-4000-8000-000000000934', 100, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE);
END $$;

-- deployment-payer shape (behavior #23): on_behalf_of set, workspace/org NULL.
INSERT INTO usage_logs (user_id, on_behalf_of, action, provider, credits_used, credits_charged, status, workspace_id, org_id, created_at, metadata)
VALUES ('00000000-0000-4000-8000-000000000932', '00000000-0000-4000-8000-000000000933', 'generate', 'kie', 10, 10, 'committed', NULL, NULL, now(), '{}'::jsonb);

-- App-markup variance row (behavior #kind, #var-narrow): the 352-shaped ledger
-- row that SHARES source='org_usage_variance' with the metered overrun but has
-- NO usage_logs counterpart. Hand-inserted with 352's exact description prefix
-- (calling process_app_monetization would need approved-app fixtures). Runner is
-- B (933), a DIFFERENT member than the metered overrun's runner A (932), so the
-- member self-view narrowing (P15R-01) is proven across two distinct members:
-- A's self-view must not see B's app markup and B's must not see A's overrun.
INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, org_id, workspace_id, job_id, created_at)
VALUES ('00000000-0000-4000-8000-000000000933', 9, 'org', 'org_usage_variance',
        'App markup beyond workspace headroom, absorbed by the platform (run test-markup)',
        'a0000000-0000-4000-8000-000000000931', 'b0000000-0000-4000-8000-000000000931', NULL, now());

-- COALESCE-pin row (behavior #model-coalesce): action <> metadata.model, in its
-- own April window, to prove the reader takes metadata->>'model' first.
INSERT INTO usage_logs (user_id, action, provider, credits_used, credits_charged, status, workspace_id, org_id, created_at, metadata)
VALUES ('00000000-0000-4000-8000-000000000932', 'generate', 'kie', 2, 2, 'committed',
        'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '2026-04-10T12:00:00Z',
        '{"model": "x-model"}'::jsonb);

-- Hand-inserted, controlled-created_at rows live in their OWN date windows so
-- the recent-window (real-RPC) assertions never see them and vice versa.
-- tz row (behavior #1): 2026-03-01 23:30Z buckets 03-01 (UTC) / 03-02 (Asia/Jerusalem).
INSERT INTO usage_logs (user_id, action, provider, credits_used, credits_charged, status, workspace_id, org_id, created_at, metadata)
VALUES ('00000000-0000-4000-8000-000000000932', 'generate', 'kie', 10, 10, 'committed',
        'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '2026-03-01T23:30:00Z', '{}'::jsonb);

-- keyset rows (behavior #9): 5 rows in Feb, two sharing an identical created_at.
INSERT INTO usage_logs (id, user_id, action, provider, credits_used, credits_charged, status, workspace_id, org_id, created_at, metadata) VALUES
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000932', 'generate', 'kie', 1, 1, 'committed', 'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '2026-02-10T10:00:00Z', '{}'::jsonb),
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000932', 'generate', 'kie', 1, 1, 'committed', 'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '2026-02-10T09:00:00Z', '{}'::jsonb),
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000932', 'generate', 'kie', 1, 1, 'committed', 'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '2026-02-10T08:00:00Z', '{}'::jsonb),
  ('cccccccc-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000932', 'generate', 'kie', 1, 1, 'committed', 'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '2026-02-10T07:00:00Z', '{}'::jsonb),
  ('cccccccc-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000932', 'generate', 'kie', 1, 1, 'committed', 'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931', '2026-02-10T07:00:00Z', '{}'::jsonb);

-- limit-clamp rows (behavior #21): 1001 distinct-timestamp rows in Jan.
INSERT INTO usage_logs (user_id, action, provider, credits_used, credits_charged, status, workspace_id, org_id, created_at, metadata)
SELECT '00000000-0000-4000-8000-000000000932', 'generate', 'kie', 3, 3, 'committed',
       'b0000000-0000-4000-8000-000000000931', 'a0000000-0000-4000-8000-000000000931',
       '2026-01-15T00:00:00Z'::timestamptz + (g || ' seconds')::interval, '{}'::jsonb
FROM generate_series(1, 1001) g;

-- ================================================================ assertions
-- Recent window (real-RPC rows). CURRENT_DATE ± 1 keeps a midnight-boundary run
-- inside a 3-day window, well under the 366-day cap.

-- #4 metered overrun -> variance line = 15; the log kept the true actual 45.
SELECT pg_temp.assert_eq('#4 metered-overrun variance for live ws = 15',
  (SELECT credits::text FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC') WHERE kind = 'metered_overrun'), '15');
SELECT pg_temp.assert_eq('#4 org_usage_report settled for A''s overrun row = 45',
  (SELECT settled_credits::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000932')), '45');
-- chargedToBudget = settled (45) - platformAbsorbed (15) = 30 (the budget slice,
-- proven at fixture time above); the route computes this subtraction in totals.

-- #3 settled vs in-flight, isolated on C.
SELECT pg_temp.assert_eq('#3 C credits = 27',
  (SELECT credits::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000935')), '27');
SELECT pg_temp.assert_eq('#3 C settled = 7',
  (SELECT settled_credits::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000935')), '7');
SELECT pg_temp.assert_eq('#3 C in_flight = 20',
  (SELECT in_flight_credits::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000935')), '20');
SELECT pg_temp.assert_eq('#3 C in_flight_runs = 1',
  (SELECT in_flight_runs::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000935')), '1');

-- #2 refunded row excluded (before/after), isolated on D.
DO $$
DECLARE v_before INT; v_after_runs INT; v_after_credits INT; v_refund UUID;
BEGIN
  -- D's baseline: one committed 12.
  PERFORM commit_credits(
    reserve_credits('00000000-0000-4000-8000-000000000936', 12, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931'), 12);
  v_refund := reserve_credits('00000000-0000-4000-8000-000000000936', 5, NULL, NULL, NULL, NULL, FALSE, NULL, FALSE, 'b0000000-0000-4000-8000-000000000931');
  SELECT run_count INTO v_before FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000936');
  PERFORM pg_temp.assert_eq('#2 D run_count before refund = 2', v_before::text, '2');
  PERFORM refund_credits(v_refund);
  SELECT run_count, credits INTO v_after_runs, v_after_credits FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000936');
  PERFORM pg_temp.assert_eq('#2 D run_count after refund = 1', v_after_runs::text, '1');
  PERFORM pg_temp.assert_eq('#2 D credits after refund = 12 (refunded 5 excluded)', v_after_credits::text, '12');
END $$;

-- #5 member grouping never contains the variance (no NULL user_id row).
SELECT pg_temp.assert_eq('#5 no NULL-user row in member grouping',
  (SELECT count(*)::text FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member') WHERE user_id IS NULL), '0');

-- #6 workspace scope ignores the sibling; org scope by workspace sees both.
SELECT pg_temp.assert_eq('#6 live-ws member grouping has no archived-ws runner rows',
  (SELECT count(*)::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member')
     WHERE user_id NOT IN ('00000000-0000-4000-8000-000000000932','00000000-0000-4000-8000-000000000933','00000000-0000-4000-8000-000000000935','00000000-0000-4000-8000-000000000936','00000000-0000-4000-8000-000000000937','00000000-0000-4000-8000-000000000938')), '0');
SELECT pg_temp.assert_eq('#6 org grouping by workspace lists both workspaces',
  (SELECT count(*)::text FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'workspace')), '2');

-- #7 p_user_id narrows to B; run_count matches B's single committed run.
SELECT pg_temp.assert_eq('#7 B self-view run_count = 1',
  (SELECT run_count::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000933')), '1');
SELECT pg_temp.assert_eq('#7 B self-view rows are only B',
  (SELECT count(*)::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000933') WHERE user_id <> '00000000-0000-4000-8000-000000000933'), '0');

-- #8 model key: E's flux-2-pro and NULL-model ('generate') group correctly.
SELECT pg_temp.assert_eq('#8 E has a flux-2-pro model group',
  (SELECT run_count::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'model', NULL, '00000000-0000-4000-8000-000000000937') WHERE group_key = 'flux-2-pro'), '1');
SELECT pg_temp.assert_eq('#8 E NULL-model run groups under action generate',
  (SELECT run_count::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'model', NULL, '00000000-0000-4000-8000-000000000937') WHERE group_key = 'generate'), '1');

-- #1 tz bucketing (March window).
SELECT pg_temp.assert_eq('#1 UTC buckets the 23:30Z run to 2026-03-01',
  (SELECT group_key FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'UTC', 'day') LIMIT 1), '2026-03-01');
SELECT pg_temp.assert_eq('#1 Asia/Jerusalem buckets it to 2026-03-02',
  (SELECT group_key FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'Asia/Jerusalem', 'day') LIMIT 1), '2026-03-02');

-- #9 keyset paging over the 5 Feb rows, p_limit = 2, stable across the tie.
DO $$
DECLARE r RECORD; ids UUID[] := '{}'; last_c TIMESTAMPTZ; last_i UUID; n INT;
BEGIN
  -- page 1
  n := 0;
  FOR r IN SELECT id, created_at FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-02-01', '2026-02-28', 'UTC', NULL, NULL, NULL, NULL, 2) LOOP
    ids := ids || r.id; last_c := r.created_at; last_i := r.id; n := n + 1;
  END LOOP;
  PERFORM pg_temp.assert_eq('#9 page 1 has 2 rows', n::text, '2');
  -- page 2
  n := 0;
  FOR r IN SELECT id, created_at FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-02-01', '2026-02-28', 'UTC', NULL, NULL, last_c, last_i, 2) LOOP
    ids := ids || r.id; last_c := r.created_at; last_i := r.id; n := n + 1;
  END LOOP;
  PERFORM pg_temp.assert_eq('#9 page 2 has 2 rows', n::text, '2');
  -- page 3
  n := 0;
  FOR r IN SELECT id, created_at FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-02-01', '2026-02-28', 'UTC', NULL, NULL, last_c, last_i, 2) LOOP
    ids := ids || r.id; n := n + 1;
  END LOOP;
  PERFORM pg_temp.assert_eq('#9 page 3 has 1 row', n::text, '1');
  PERFORM pg_temp.assert_eq('#9 all 5 distinct across pages (tie never repeats)', (SELECT count(DISTINCT x)::text FROM unnest(ids) x), '5');
END $$;

-- #10 INVALID_TIMEZONE / #11 RANGE_TOO_LARGE / #12 BAD_GROUP_BY / #18 BAD_SCOPE / #19 inverted+missing.
SELECT pg_temp.assert_raises('#10 unknown tz raises INVALID_TIMEZONE',
  $q$SELECT * FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'Mars/Olympus', 'day')$q$, 'INVALID_TIMEZONE:');
SELECT pg_temp.assert_raises('#11 367-day range raises RANGE_TOO_LARGE',
  $q$SELECT * FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', '2025-01-01', '2026-01-02', 'UTC', 'day')$q$, 'RANGE_TOO_LARGE:');
SELECT pg_temp.assert_eq('#11 a 365-day span (inclusive) is allowed',
  (SELECT count(*) >= 0 FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', '2025-01-01', '2026-01-01', 'UTC', 'day'))::text, 'true');
SELECT pg_temp.assert_raises('#12 workspace grouping on a workspace scope raises BAD_GROUP_BY',
  $q$SELECT * FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'UTC', 'workspace')$q$, 'BAD_GROUP_BY:');
SELECT pg_temp.assert_raises('#12 an unknown grouping raises BAD_GROUP_BY',
  $q$SELECT * FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'UTC', 'foo')$q$, 'BAD_GROUP_BY:');
SELECT pg_temp.assert_raises('#18 BAD_SCOPE on org_usage_report',
  $q$SELECT * FROM org_usage_report('team', 'a0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'UTC', 'day')$q$, 'BAD_SCOPE:');
SELECT pg_temp.assert_raises('#18 BAD_SCOPE on org_usage_rows',
  $q$SELECT * FROM org_usage_rows('team', 'a0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'UTC')$q$, 'BAD_SCOPE:');
SELECT pg_temp.assert_raises('#18 BAD_SCOPE on org_usage_variance',
  $q$SELECT * FROM org_usage_variance('team', 'a0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', 'UTC')$q$, 'BAD_SCOPE:');
SELECT pg_temp.assert_raises('#19 to < from raises RANGE_TOO_LARGE (report)',
  $q$SELECT * FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', '2026-03-02', '2026-03-01', 'UTC', 'day')$q$, 'RANGE_TOO_LARGE:');
SELECT pg_temp.assert_raises('#19 NULL from raises RANGE_TOO_LARGE (rows)',
  $q$SELECT * FROM org_usage_rows('org', 'a0000000-0000-4000-8000-000000000931', NULL, '2026-03-01', 'UTC')$q$, 'RANGE_TOO_LARGE:');
SELECT pg_temp.assert_raises('#19 NULL to raises RANGE_TOO_LARGE (report)',
  $q$SELECT * FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', '2026-03-01', NULL, 'UTC', 'day')$q$, 'RANGE_TOO_LARGE:');

-- #14 grants + volatility.
SELECT pg_temp.assert_eq('#14 authenticated cannot execute the readers',
  (SELECT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text FROM pg_proc p
    WHERE proname IN ('org_usage_report','org_usage_rows','org_usage_totals','org_usage_variance','org_usage_window')), 'false');
SELECT pg_temp.assert_eq('#14 anon cannot execute the readers',
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::text FROM pg_proc p
    WHERE proname IN ('org_usage_report','org_usage_rows','org_usage_totals','org_usage_variance','org_usage_window')), 'false');
SELECT pg_temp.assert_eq('#14 service_role can execute all five',
  (SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))::text FROM pg_proc p
    WHERE proname IN ('org_usage_report','org_usage_rows','org_usage_totals','org_usage_variance','org_usage_window')), 'true');
SELECT pg_temp.assert_eq('#14 all five are STABLE (provolatile s)',
  (SELECT bool_and(provolatile = 's')::text FROM pg_proc
    WHERE proname IN ('org_usage_report','org_usage_rows','org_usage_totals','org_usage_variance','org_usage_window')), 'true');
SELECT pg_temp.assert_eq('#14 all five pin search_path with pg_temp',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname IN ('org_usage_report','org_usage_rows','org_usage_totals','org_usage_variance','org_usage_window')
      AND prosecdef AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'), '5');
SELECT pg_temp.assert_eq('#14 each reader has exactly one overload',
  (SELECT bool_and(c = 1)::text FROM (SELECT proname, count(*) c FROM pg_proc
    WHERE proname IN ('org_usage_report','org_usage_rows','org_usage_totals','org_usage_variance','org_usage_window') GROUP BY proname) q), 'true');

-- #15 the variance index is present and partial.
SELECT pg_temp.assert_eq('#15 idx_credit_tx_variance_org_created is partial on source',
  (SELECT (indexdef LIKE '%WHERE (source = ''org_usage_variance''::text)%')::text FROM pg_indexes
    WHERE indexname = 'idx_credit_tx_variance_org_created'), 'true');

-- #16 the personal outsider run leaks into no scope.
SELECT pg_temp.assert_eq('#16 outsider is invisible to org scope',
  (SELECT count(*)::text FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member') WHERE user_id = '00000000-0000-4000-8000-000000000934'), '0');

-- #17 no cost/usd token in any reader's argument or OUT column names.
SELECT pg_temp.assert_eq('#17 no cost/usd/price name on any reader',
  (SELECT count(*)::text FROM pg_proc, unnest(COALESCE(proargnames, '{}')) AS an
    WHERE proname IN ('org_usage_report','org_usage_rows','org_usage_totals','org_usage_variance') AND an ~* '(cost|usd|price|dollar|margin|markup)'), '0');

-- #20 p_workspace_id narrows an org report + its variance to one workspace.
SELECT pg_temp.assert_eq('#20 org report narrowed to the archived ws has A''s run only',
  (SELECT run_count::text FROM org_usage_report('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', 'b0000000-0000-4000-8000-000000000932')), '1');
SELECT pg_temp.assert_eq('#20 variance narrowed to the archived ws is empty (overrun was in the live ws)',
  (SELECT count(*)::text FROM org_usage_variance('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'b0000000-0000-4000-8000-000000000932')), '0');

-- #21 p_limit clamps to [1, 1000] over the 1001 Jan rows.
SELECT pg_temp.assert_eq('#21 p_limit 5000 clamps to 1000',
  (SELECT count(*)::text FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-01-01', '2026-01-31', 'UTC', NULL, NULL, NULL, NULL, 5000)), '1000');
SELECT pg_temp.assert_eq('#21 p_limit 0 clamps to 1',
  (SELECT count(*)::text FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-01-01', '2026-01-31', 'UTC', NULL, NULL, NULL, NULL, 0)), '1');
SELECT pg_temp.assert_eq('#21 p_limit NULL defaults to 50',
  (SELECT count(*)::text FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-01-01', '2026-01-31', 'UTC', NULL, NULL, NULL, NULL, NULL)), '50');

-- #22 a refunded row is absent from org_usage_rows too (D's refunded 5-credit run).
SELECT pg_temp.assert_eq('#22 no refunded (5-credit) row appears in the rows reader for D',
  (SELECT count(*)::text FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000936') WHERE status = 'refunded'), '0');

-- #23 the deployment-payer row (workspace/org NULL, on_behalf_of set) is
-- invisible to both scopes. Its runner is A (932); the row is out of scope by
-- its NULL workspace_id/org_id, so no reader surfaces it.
SELECT pg_temp.assert_eq('#23 the deployment-payer row exists (not vacuous)',
  (SELECT count(*)::text FROM usage_logs WHERE on_behalf_of = '00000000-0000-4000-8000-000000000933' AND workspace_id IS NULL AND org_id IS NULL), '1');
SELECT pg_temp.assert_eq('#23 no on_behalf_of row surfaces in the org rows reader',
  (SELECT count(*)::text FROM org_usage_rows('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC') ur
     JOIN usage_logs ul ON ul.id = ur.id WHERE ul.on_behalf_of IS NOT NULL), '0');

-- #kind the variance line is split by origin: metered overrun (15) vs app markup (9).
SELECT pg_temp.assert_eq('#kind app-markup variance for live ws = 9',
  (SELECT credits::text FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC') WHERE kind = 'app_markup'), '9');
SELECT pg_temp.assert_eq('#kind org-scope variance returns both kinds on the live ws',
  (SELECT string_agg(kind, ',' ORDER BY kind) FROM org_usage_variance('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC')), 'app_markup,metered_overrun');

-- #var-narrow p_user_id narrows the variance line to one runner (member self-view,
-- P15R-01). Live ws has TWO variance rows by TWO members: A (932) metered overrun
-- 15, B (933) app markup 9. A member's self-view must return only its own — never
-- another member's absorbed overrun (which would make chargedToBudget negative).
SELECT pg_temp.assert_eq('#var-narrow A (932) self-view sees own metered overrun (15)',
  (SELECT string_agg(kind || '=' || credits, ',' ORDER BY kind)
     FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000932')),
  'metered_overrun=15');
SELECT pg_temp.assert_eq('#var-narrow B (933) self-view sees own app markup only — NOT A''s overrun',
  (SELECT string_agg(kind || '=' || credits, ',' ORDER BY kind)
     FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000933')),
  'app_markup=9');
SELECT pg_temp.assert_eq('#var-narrow un-narrowed workspace variance still returns both members'' rows',
  (SELECT string_agg(kind, ',' ORDER BY kind) FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC')), 'app_markup,metered_overrun');

-- #var-charged P15R-01 end to end: chargedToBudget = totals.settled − own metered
-- overrun, computed for a member self-view, must never go negative. B (933) settled
-- one run of 8 and caused NO metered overrun, so 8 − 0 = 8. Before the fix the
-- variance line was NOT narrowed, so B's self-view subtracted A's 15 → 8 − 15 = −7.
DO $$
DECLARE v_settled BIGINT; v_overrun BIGINT;
BEGIN
  SELECT settled_credits INTO v_settled
    FROM org_usage_totals('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000933');
  SELECT COALESCE(sum(credits), 0) INTO v_overrun
    FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000933')
    WHERE kind = 'metered_overrun';
  PERFORM pg_temp.assert_eq('#var-charged B self-view chargedToBudget = 8 - 0 = 8 (never negative)', (v_settled - v_overrun)::text, '8');
END $$;

-- #totals org_usage_totals aggregates the WHOLE window and equals the column-wise
-- sum of the (grouped) member report — totals never come from the capped rows.
SELECT pg_temp.assert_eq('#totals credits == sum of member report credits',
  (SELECT credits::text FROM org_usage_totals('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC')),
  (SELECT sum(credits)::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member')));
SELECT pg_temp.assert_eq('#totals settled + in_flight == credits',
  (SELECT (settled_credits + in_flight_credits = credits)::text FROM org_usage_totals('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC')), 'true');
SELECT pg_temp.assert_eq('#totals app_run_count = 1 (F''s one app run)',
  (SELECT app_run_count::text FROM org_usage_totals('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC')), '1');
SELECT pg_temp.assert_eq('#totals empty window is all zeros (one row, not none)',
  (SELECT run_count::text || ':' || credits::text FROM org_usage_totals('workspace', 'b0000000-0000-4000-8000-000000000931', '2020-01-01', '2020-01-02', 'UTC')), '0:0');

-- #rows-values the flat-rows reader carries the right money columns (a column
-- swap or COALESCE inversion in the rows SELECT ships wrong CSV numbers).
SELECT pg_temp.assert_eq('#rows-values C reserved row = 20:null:20, job NULL, not app',
  (SELECT credits_reserved || ':' || COALESCE(credits_settled::text, 'null') || ':' || credits || ':' || COALESCE(job_id::text, 'null') || ':' || is_app_run
     FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000935') WHERE status = 'reserved'),
  '20:null:20:null:false');
SELECT pg_temp.assert_eq('#rows-values C committed row = 10:7:7',
  (SELECT credits_reserved || ':' || credits_settled || ':' || credits
     FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000935') WHERE status = 'committed'),
  '10:7:7');

-- #model-coalesce the reader takes metadata->>'model' before action.
SELECT pg_temp.assert_eq('#model-coalesce a row whose action<>model groups under model',
  (SELECT group_key FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-04-01', '2026-04-30', 'UTC', 'model') LIMIT 1), 'x-model');
SELECT pg_temp.assert_eq('#model-coalesce the rows reader shows model, not action',
  (SELECT model FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-04-01', '2026-04-30', 'UTC') LIMIT 1), 'x-model');

-- #6b non-vacuous scope isolation across all readers.
SELECT pg_temp.assert_eq('#6b live-ws rows reader emits no sibling-ws row',
  (SELECT count(*)::text FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC') WHERE workspace_id <> 'b0000000-0000-4000-8000-000000000931'), '0');
SELECT pg_temp.assert_eq('#6b archived-ws rows reader returns exactly A''s 30-credit run',
  (SELECT count(*)::text || ':' || sum(credits)::text FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000932', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC')), '1:30');
SELECT pg_temp.assert_eq('#6b archived-ws report (member) is one row, credits 30',
  (SELECT count(*)::text || ':' || sum(credits)::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000932', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member')), '1:30');

-- #app F's app run surfaces on both readers.
SELECT pg_temp.assert_eq('#app F member row app_run_count = 1',
  (SELECT app_run_count::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000938')), '1');
SELECT pg_temp.assert_eq('#app F rows reader marks is_app_run true',
  (SELECT bool_and(is_app_run)::text FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000938')), 'true');

-- #5b member group_key set equals the runner set; exactly one grouping column is set.
SELECT pg_temp.assert_eq('#5b member group_key set = runner set',
  (SELECT count(*)::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member') WHERE group_key <> user_id::text), '0');
SELECT pg_temp.assert_eq('#5b member grouping sets exactly one of workspace/user/model/day',
  (SELECT count(*)::text FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member')
     WHERE (workspace_id IS NOT NULL)::int + (user_id IS NOT NULL)::int + (model IS NOT NULL)::int + (day IS NOT NULL)::int <> 1), '0');

-- #cursor a half cursor is refused loudly, not paged past.
SELECT pg_temp.assert_raises('#cursor after_created without after_id raises BAD_CURSOR',
  $q$SELECT * FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-02-01', '2026-02-28', 'UTC', NULL, NULL, now(), NULL, 2)$q$, 'BAD_CURSOR:');
SELECT pg_temp.assert_raises('#cursor after_id without after_created raises BAD_CURSOR',
  $q$SELECT * FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-02-01', '2026-02-28', 'UTC', NULL, NULL, NULL, gen_random_uuid(), 2)$q$, 'BAD_CURSOR:');

-- #rows-narrow p_workspace_id and p_user_id narrow the rows reader.
SELECT pg_temp.assert_eq('#rows-narrow org scope + p_workspace_id=archived returns only that ws',
  (SELECT count(*)::text || ':' || count(*) FILTER (WHERE workspace_id = 'b0000000-0000-4000-8000-000000000932')::text
     FROM org_usage_rows('org', 'a0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'b0000000-0000-4000-8000-000000000932')), '1:1');
SELECT pg_temp.assert_eq('#rows-narrow workspace scope + p_user_id returns only that member',
  (SELECT count(*) FILTER (WHERE user_id <> '00000000-0000-4000-8000-000000000936')::text
     FROM org_usage_rows('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', NULL, '00000000-0000-4000-8000-000000000936')), '0');

-- #tznull a NULL p_tz defaults to UTC (same bucket as the explicit 'UTC' call).
SELECT pg_temp.assert_eq('#tznull NULL tz buckets the 23:30Z run to 2026-03-01 (UTC default)',
  (SELECT group_key FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', '2026-03-01', '2026-03-02', NULL, 'day') LIMIT 1), '2026-03-01');

-- #13 deleted member takes their usage rows, NOT the platform-absorbed line.
-- LAST, because it cascade-deletes A's rows (needed by #1/#9/#20/#21/#23 above).
DO $$
DECLARE v_runs_before BIGINT; v_runs_after BIGINT; v_var_before BIGINT; v_var_after BIGINT; v_var_user UUID;
BEGIN
  SELECT run_count INTO v_runs_before FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000932');
  SELECT credits INTO v_var_before FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC') WHERE kind = 'metered_overrun';
  DELETE FROM profiles WHERE id = '00000000-0000-4000-8000-000000000932';   -- cascades usage_logs, SET NULL on A's metered variance row (B's app-markup row is untouched)
  SELECT COALESCE(sum(run_count), 0) INTO v_runs_after FROM org_usage_report('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC', 'member', NULL, '00000000-0000-4000-8000-000000000932');
  SELECT credits INTO v_var_after FROM org_usage_variance('workspace', 'b0000000-0000-4000-8000-000000000931', CURRENT_DATE - 1, CURRENT_DATE + 1, 'UTC') WHERE kind = 'metered_overrun';
  SELECT user_id INTO v_var_user FROM credit_transactions WHERE source = 'org_usage_variance' AND workspace_id = 'b0000000-0000-4000-8000-000000000931' AND description LIKE 'Metered overrun%';
  PERFORM pg_temp.assert_eq('#13 A had runs before delete', (v_runs_before > 0)::text, 'true');
  PERFORM pg_temp.assert_eq('#13 A''s runs are gone after delete', v_runs_after::text, '0');
  PERFORM pg_temp.assert_eq('#13 the platform-absorbed line is unchanged', v_var_after::text, v_var_before::text);
  PERFORM pg_temp.assert_eq('#13 the variance row survived with user_id NULL', (v_var_user IS NULL)::text, 'true');
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
