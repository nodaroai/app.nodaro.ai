-- ============================================================================
-- Behavioral proof: migration 554 — metered LLM SIDE holds: a metered hold for
-- one LLM call a job makes beside its own reservation (a UGC clip's frame
-- check), that never touches the job's billing.
--
-- Runs AFTER the whole migration chain, in a transaction that rolls back. Its
-- own uuid range (...-0000000551xx).
--
--   1  the side hold: a usage log with NO job, marked 'side', its own row and
--      ledger line; the job's usage_log_id / credits untouched.
--   2  a key replay returns the same hold, debits nothing twice.
--   3  the clip's managed reservation is unaffected: 391's replay still
--      replays, 393's checkpoint and settle still run (no CONFLICT).
--   4  a side hold made BEFORE the job's own reservation: 391 still reserves
--      (no "job already has usage").
--   5  the call-start CAS: started on a live job; not-live once cancelled;
--      closed once settled.
--   6  it settles through commit_credits_metered at an actual above the hold
--      (the overrun collected), the job's credits_actual untouched.
--   7  refusals: a job not live, another user's job, a key naming another hold.
--   8  grants: no client role can execute the functions or read the table.
--   9  a reprice between attempts replays the hold already reserved.
--   10 R57: refund_settled_side_hold gives a charged side hold back once (side logs only).
--   11 the refund of a WORKSPACE-paid side hold gives the budget (and the
--      member) back what 351's clamp SPENT — never the whole charge, whose
--      overrun beyond the headroom the platform absorbed as org_usage_variance.
--   12 R61: refund_settled_metered_charge reverses a job's OWN settled metered
--      charge (hold + collected overrun) once, only for that job's own log,
--      only once the job is failed or cancelled; never a side log, never a
--      completed job.
--   13 grants: the reversal functions run for the service role only.
-- ============================================================================
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('00000000-0000-4000-8000-000000055101','side-hold-1@example.test'),
  ('00000000-0000-4000-8000-000000055102','side-hold-2@example.test');
UPDATE public.profiles SET tier='business',subscription_tier='business',subscription_credits=1000,topup_credits=0,
  daily_spent_credits=0,lifetime_topup_credits=1
 WHERE id IN ('00000000-0000-4000-8000-000000055101','00000000-0000-4000-8000-000000055102');
INSERT INTO public.jobs(id,user_id,status) VALUES
  ('00000000-0000-4000-8000-000000055111','00000000-0000-4000-8000-000000055101','processing'),
  ('00000000-0000-4000-8000-000000055112','00000000-0000-4000-8000-000000055101','pending'),
  ('00000000-0000-4000-8000-000000055113','00000000-0000-4000-8000-000000055101','cancelled'),
  ('00000000-0000-4000-8000-000000055114','00000000-0000-4000-8000-000000055102','processing'),
  ('00000000-0000-4000-8000-000000055115','00000000-0000-4000-8000-000000055101','processing');

-- 11 / 12: a workspace (the ccm proof's fixture shape) — owner ...055103, member ...055104.
INSERT INTO auth.users(id,email) VALUES
  ('00000000-0000-4000-8000-000000055103','side-hold-ws-owner@example.test'),
  ('00000000-0000-4000-8000-000000055104','side-hold-ws-member@example.test');
UPDATE public.profiles SET tier='business',subscription_tier='business',subscription_credits=0,topup_credits=0,
  daily_spent_credits=0,lifetime_topup_credits=1
 WHERE id IN ('00000000-0000-4000-8000-000000055103','00000000-0000-4000-8000-000000055104');
INSERT INTO public.organizations (id, slug, name, kind, owner_user_id, status, settings) VALUES
  ('a0000000-0000-4000-8000-000000055101', 'side-hold-org', 'Side Hold Org', 'school',
   '00000000-0000-4000-8000-000000055103', 'active', '{}');
INSERT INTO public.workspaces (id, org_id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000055101', 'a0000000-0000-4000-8000-000000055101', 'Side Hold WS', 'side-hold-ws');
INSERT INTO public.organization_members (org_id, user_id, role, status) VALUES
  ('a0000000-0000-4000-8000-000000055101', '00000000-0000-4000-8000-000000055103', 'owner', 'active'),
  ('a0000000-0000-4000-8000-000000055101', '00000000-0000-4000-8000-000000055104', 'member', 'active');
INSERT INTO public.workspace_members (workspace_id, org_id, user_id, role, status) VALUES
  ('b0000000-0000-4000-8000-000000055101', 'a0000000-0000-4000-8000-000000055101', '00000000-0000-4000-8000-000000055104', 'member', 'active');
SELECT public.grant_org_credits_idempotent('a0000000-0000-4000-8000-000000055101', 100, 'cs_side_hold_org', 'org_purchase', 2.50);
SELECT public.allocate_workspace_credits('a0000000-0000-4000-8000-000000055101',
  'b0000000-0000-4000-8000-000000055101', 10, '00000000-0000-4000-8000-000000055103');
INSERT INTO public.jobs(id,user_id,status,workspace_id) VALUES
  ('00000000-0000-4000-8000-000000055121','00000000-0000-4000-8000-000000055104','processing','b0000000-0000-4000-8000-000000055101');
-- 12: the job's own metered charges.
INSERT INTO public.jobs(id,user_id,status) VALUES
  ('00000000-0000-4000-8000-000000055131','00000000-0000-4000-8000-000000055102','processing'),
  ('00000000-0000-4000-8000-000000055132','00000000-0000-4000-8000-000000055102','processing');

CREATE FUNCTION pg_temp.balance() RETURNS integer LANGUAGE sql AS $$
  SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-000000055101'
$$;
CREATE FUNCTION pg_temp.refuse(statement text, prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN IF position(prefix IN SQLERRM) > 0 THEN RAISE NOTICE 'ok refused %', prefix; RETURN; END IF; RAISE; END;
  RAISE EXCEPTION 'ASSERT FAIL: expected refusal %', prefix;
END $$;

-- 8. No client role can execute the functions or read the table.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055111','image-to-text:claude-sonnet-5.5');
  RAISE EXCEPTION 'ASSERT FAIL: authenticated reserve';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok reserve direct execution denied'; END $$;
DO $$ BEGIN
  PERFORM public.llm_side_hold_call_starting('00000000-0000-4000-8000-000000055101');
  RAISE EXCEPTION 'ASSERT FAIL: authenticated call start';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok call start direct execution denied'; END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.llm_side_holds LIMIT 1;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated read the side-hold table';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok side-hold table unreadable by authenticated'; END $$;
RESET ROLE;

SET LOCAL ROLE service_role;

-- 1–3, 5, 6 on the clip job ...551111.
DO $$
DECLARE
  v_clip jsonb; v_clip_log uuid; r jsonb; v_side uuid; v_started text; m jsonb;
BEGIN
  -- The clip's own managed (job-once) reservation.
  v_clip := public.reserve_job_credits('00000000-0000-4000-8000-000000055101',100,'00000000-0000-4000-8000-000000055111','test-ugc-clip');
  v_clip_log := (v_clip->>'usageLogId')::uuid;

  -- 1. The side hold.
  r := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055111',
         'image-to-text:claude-sonnet-5.5','take:1');
  v_side := (r->>'usageLogId')::uuid;
  IF r->>'replayed' <> 'false' OR (r->>'creditsReserved')::int <> 4 THEN RAISE EXCEPTION 'ASSERT FAIL: side reserve answer %', r; END IF;
  IF (SELECT job_id FROM public.usage_logs WHERE id=v_side) IS NOT NULL THEN RAISE EXCEPTION 'ASSERT FAIL: the side log names the job'; END IF;
  IF (SELECT metadata->>'reservation_mode' FROM public.usage_logs WHERE id=v_side) <> 'side' THEN RAISE EXCEPTION 'ASSERT FAIL: side log unmarked'; END IF;
  IF (SELECT status FROM public.usage_logs WHERE id=v_side) <> 'reserved' THEN RAISE EXCEPTION 'ASSERT FAIL: side log not reserved'; END IF;
  IF (SELECT job_id FROM public.llm_side_holds WHERE usage_log_id=v_side) <> '00000000-0000-4000-8000-000000055111'
     OR (SELECT pre_call FROM public.llm_side_holds WHERE usage_log_id=v_side) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERT FAIL: side-hold row';
  END IF;
  IF (SELECT usage_log_id FROM public.jobs WHERE id='00000000-0000-4000-8000-000000055111') <> v_clip_log
     OR (SELECT credits FROM public.jobs WHERE id='00000000-0000-4000-8000-000000055111') <> 100 THEN
    RAISE EXCEPTION 'ASSERT FAIL: the side hold touched the job';
  END IF;
  IF pg_temp.balance() <> 896 THEN RAISE EXCEPTION 'ASSERT FAIL: balance after both holds %', pg_temp.balance(); END IF;
  IF (SELECT count(*) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-000000055111' AND amount=-4) <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: the side debit''s ledger line';
  END IF;
  RAISE NOTICE 'ok a side hold is a job-less usage log with its own row; the job is untouched';

  -- 2. A key replay.
  r := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055111',
         'image-to-text:claude-sonnet-5.5','take:1');
  IF r->>'replayed' <> 'true' OR (r->>'usageLogId')::uuid <> v_side OR pg_temp.balance() <> 896
     OR (SELECT count(*) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-000000055111' AND amount=-4) <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: replay %', r;
  END IF;
  RAISE NOTICE 'ok a key replay returns the same hold and debits nothing twice';

  -- 3. The clip's managed reservation is unaffected.
  r := public.reserve_job_credits('00000000-0000-4000-8000-000000055101',100,'00000000-0000-4000-8000-000000055111','test-ugc-clip');
  IF r->>'replayed' <> 'true' THEN RAISE EXCEPTION 'ASSERT FAIL: the clip reservation no longer replays'; END IF;
  PERFORM public.checkpoint_job_settlement('00000000-0000-4000-8000-000000055111','00000000-0000-4000-8000-000000055101',
    v_clip_log,1,60,true,repeat('a',64),0.5);
  RAISE NOTICE 'ok the clip''s replay and checkpoint run beside the side hold';

  -- 5. The call-start CAS on a live job.
  v_started := public.llm_side_hold_call_starting(v_side);
  IF v_started <> 'started' OR (SELECT pre_call FROM public.llm_side_holds WHERE usage_log_id=v_side) IS NOT FALSE
     OR (SELECT call_started_at FROM public.llm_side_holds WHERE usage_log_id=v_side) IS NULL THEN
    RAISE EXCEPTION 'ASSERT FAIL: call start %', v_started;
  END IF;
  IF (SELECT provider_call_started_at FROM public.jobs WHERE id='00000000-0000-4000-8000-000000055111') IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERT FAIL: the side call stamped the job';
  END IF;
  RAISE NOTICE 'ok the call start stamps the hold, never the job';

  -- 6. Settled at an actual above the hold (6 > 4): the overrun is collected.
  m := public.commit_credits_metered(v_side, 6);
  IF (m->>'charged')::int <> 6 OR (m->>'collected_over_hold')::int <> 2 OR pg_temp.balance() <> 894 THEN
    RAISE EXCEPTION 'ASSERT FAIL: metered settle %', m;
  END IF;
  IF (SELECT credits_actual FROM public.jobs WHERE id='00000000-0000-4000-8000-000000055111') IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERT FAIL: the side settle wrote the job''s credits_actual';
  END IF;
  RAISE NOTICE 'ok the side hold settles at its actual; the job''s charge is untouched';

  -- 5 (cont.). A settled hold never starts a call.
  IF public.llm_side_hold_call_starting(v_side) <> 'closed' THEN RAISE EXCEPTION 'ASSERT FAIL: a settled hold started a call'; END IF;
  RAISE NOTICE 'ok a settled hold answers closed';

  -- 3 (cont.). The clip still settles from its own checkpoint.
  UPDATE public.jobs SET status='completed' WHERE id='00000000-0000-4000-8000-000000055111';
  r := public.settle_checkpointed_job_reservation(v_clip_log);
  IF r->'settlement'->>'actualCredits' <> '60' OR pg_temp.balance() <> 934 THEN
    RAISE EXCEPTION 'ASSERT FAIL: the clip settle %, balance %', r, pg_temp.balance();
  END IF;
  RAISE NOTICE 'ok the clip settles from its own checkpoint beside a settled side hold';
END $$;

-- 4 and 5: a side hold BEFORE the job's own reservation; the CAS after a cancel.
DO $$
DECLARE r jsonb; v_side uuid;
BEGIN
  r := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055112','image-to-text:claude-sonnet-5.5');
  v_side := (r->>'usageLogId')::uuid;
  r := public.reserve_job_credits('00000000-0000-4000-8000-000000055101',100,'00000000-0000-4000-8000-000000055112','test-ugc-clip');
  IF r->>'replayed' <> 'false' THEN RAISE EXCEPTION 'ASSERT FAIL: 391 after a side hold %', r; END IF;
  RAISE NOTICE 'ok 391 reserves a job that already has a side hold';
  UPDATE public.jobs SET status='cancelled' WHERE id='00000000-0000-4000-8000-000000055112';
  IF public.llm_side_hold_call_starting(v_side) <> 'not-live' THEN RAISE EXCEPTION 'ASSERT FAIL: a cancelled job started a side call'; END IF;
  IF (SELECT pre_call FROM public.llm_side_holds WHERE usage_log_id=v_side) IS NOT TRUE THEN RAISE EXCEPTION 'ASSERT FAIL: not-live stamped'; END IF;
  RAISE NOTICE 'ok a cancelled job never starts a side call';
END $$;

-- 7. Refusals.
SELECT pg_temp.refuse($q$SELECT public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055113','image-to-text:claude-sonnet-5.5')$q$, 'SIDE_HOLD_INACTIVE:');
SELECT pg_temp.refuse($q$SELECT public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055114','image-to-text:claude-sonnet-5.5')$q$, 'SIDE_HOLD_INACTIVE:');
SELECT pg_temp.refuse($q$SELECT public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',5,'00000000-0000-4000-8000-000000055111','image-to-text:claude-sonnet-5.5','take:1')$q$, 'SIDE_HOLD_INACTIVE:');
SELECT pg_temp.refuse($q$SELECT public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',-1,'00000000-0000-4000-8000-000000055111','x:y')$q$, 'SIDE_HOLD_INVALID:');
SELECT (public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055115','image-to-text:claude-sonnet-5.5','take:9')->>'replayed') = 'false' AS first_take9;
-- The same key under another charge id is another call: a conflict.
SELECT pg_temp.refuse($q$SELECT public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055115','image-to-text:gpt-6','take:9')$q$, 'SIDE_HOLD_CONFLICT:');
-- A key whose hold was settled: SIDE_HOLD_KEY_SETTLED (a retried attempt reserves under a new key).
SELECT public.commit_credits_metered((SELECT usage_log_id FROM public.llm_side_holds WHERE hold_key='take:9'), 3) IS NOT NULL AS settled_take9;
SELECT pg_temp.refuse($q$SELECT public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055115','image-to-text:claude-sonnet-5.5','take:9')$q$, 'SIDE_HOLD_KEY_SETTLED:');

-- Round 3: a reprice between attempts replays the hold already reserved (never a conflict).
DO $$
DECLARE r jsonb; r2 jsonb;
BEGIN
  r := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055115','image-to-text:claude-sonnet-5.5','take:20');
  r2 := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',6,'00000000-0000-4000-8000-000000055115','image-to-text:claude-sonnet-5.5','take:20');
  IF r2->>'replayed' <> 'true' OR (r2->>'usageLogId') <> (r->>'usageLogId') OR (r2->>'creditsReserved')::int <> 4 THEN
    RAISE EXCEPTION 'ASSERT FAIL: a repriced replay %', r2;
  END IF;
  RAISE NOTICE 'ok a reprice between attempts replays the hold already reserved';
END $$;

-- R57: a deliberate platform refund of a CHARGED side hold (a withdrawn held job).
DO $$
DECLARE r jsonb; v_log uuid; v_before int; v_other uuid;
BEGIN
  r := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055115','image-to-text:claude-sonnet-5.5','take:21');
  v_log := (r->>'usageLogId')::uuid;
  PERFORM public.commit_credits_metered(v_log, 3);
  v_before := pg_temp.balance();
  IF public.refund_settled_side_hold(v_log) <> 'refunded' THEN RAISE EXCEPTION 'ASSERT FAIL: side refund'; END IF;
  IF pg_temp.balance() <> v_before + 3 OR (SELECT status FROM public.usage_logs WHERE id = v_log) <> 'refunded'
     OR (SELECT outcome FROM public.llm_side_holds WHERE usage_log_id = v_log) <> 'refunded'
     OR (SELECT count(*) FROM public.credit_transactions WHERE job_id = '00000000-0000-4000-8000-000000055115' AND source = 'refund' AND amount = 3) <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: side refund effects (balance % → %)', v_before, pg_temp.balance();
  END IF;
  -- Never twice; never a log that is not a side hold.
  IF public.refund_settled_side_hold(v_log) <> 'not-committed' THEN RAISE EXCEPTION 'ASSERT FAIL: side refund twice'; END IF;
  v_other := public.reserve_credits('00000000-0000-4000-8000-000000055101', 5, '00000000-0000-4000-8000-000000055115', 'test-ugc-clip');
  PERFORM public.commit_credits(v_other, 5);
  IF public.refund_settled_side_hold(v_other) <> 'not-committed' THEN RAISE EXCEPTION 'ASSERT FAIL: refunded a non-side log'; END IF;
  RAISE NOTICE 'ok a charged side hold is refunded once, by the platform, side logs only';
END $$;

-- 11. A workspace-paid side hold refunded: the budget gets back what the clamp SPENT.
DO $$
DECLARE v_prior uuid; r jsonb; v_side uuid; m jsonb;
BEGIN
  -- 5 of the 10 allocated already spent; a hold of 4 then settled at 8: the
  -- clamp spends the 5 of headroom left and absorbs 3 as org_usage_variance.
  v_prior := public.reserve_credits('00000000-0000-4000-8000-000000055104', 5, NULL, 'test-prior-spend',
               p_workspace_id => 'b0000000-0000-4000-8000-000000055101');
  PERFORM public.commit_credits(v_prior, 5);
  r := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055104',4,'00000000-0000-4000-8000-000000055121',
         'image-to-text:claude-sonnet-5.5', NULL, false, NULL, false, 'b0000000-0000-4000-8000-000000055101');
  v_side := (r->>'usageLogId')::uuid;
  m := public.commit_credits_metered(v_side, 8);
  IF (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000055101') <> 10
     OR (m->>'shortfall')::int <> 3 THEN
    RAISE EXCEPTION 'ASSERT FAIL: the clamp setup %', m;
  END IF;
  UPDATE public.jobs SET status = 'cancelled' WHERE id = '00000000-0000-4000-8000-000000055121';
  IF public.refund_settled_side_hold(v_side) <> 'refunded' THEN RAISE EXCEPTION 'ASSERT FAIL: workspace side refund'; END IF;
  IF (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000055101') <> 5 THEN
    RAISE EXCEPTION 'ASSERT FAIL: the budget got back % (spent now %), not the 5 the clamp spent',
      10 - (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000055101'),
      (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id = 'b0000000-0000-4000-8000-000000055101');
  END IF;
  IF (SELECT amount FROM public.credit_transactions WHERE source = 'refund' AND job_id = '00000000-0000-4000-8000-000000055121') <> 5 THEN
    RAISE EXCEPTION 'ASSERT FAIL: the workspace refund line';
  END IF;
  RAISE NOTICE 'ok a workspace side refund gives back what was spent, never the absorbed overrun';
END $$;

-- 12. R61: a job's OWN settled metered charge, reversed by the platform once the job is refused.
DO $$
DECLARE v_log uuid; v_before int; v_side uuid; v_done uuid; r jsonb;
BEGIN
  UPDATE public.profiles SET subscription_credits = 100 WHERE id = '00000000-0000-4000-8000-000000055102';
  v_log := public.reserve_credits('00000000-0000-4000-8000-000000055102', 10, '00000000-0000-4000-8000-000000055131', 'llm-chat:claude-sonnet-5.5');
  PERFORM public.commit_credits_metered(v_log, 12); -- the hold 10 + 2 collected
  IF public.refund_settled_metered_charge(v_log, '00000000-0000-4000-8000-000000055131') <> 'job-live' THEN
    RAISE EXCEPTION 'ASSERT FAIL: a live job''s charge was refunded';
  END IF;
  UPDATE public.jobs SET status = 'failed' WHERE id = '00000000-0000-4000-8000-000000055131';
  IF public.refund_settled_metered_charge(v_log, '00000000-0000-4000-8000-000000055111') <> 'not-committed' THEN
    RAISE EXCEPTION 'ASSERT FAIL: another job''s id reversed this log';
  END IF;
  v_before := (SELECT subscription_credits FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000055102');
  IF public.refund_settled_metered_charge(v_log, '00000000-0000-4000-8000-000000055131') <> 'refunded' THEN
    RAISE EXCEPTION 'ASSERT FAIL: policy refund';
  END IF;
  IF (SELECT subscription_credits FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000055102') <> v_before + 12
     OR (SELECT status FROM public.usage_logs WHERE id = v_log) <> 'refunded'
     OR (SELECT metadata->'policy_refund'->>'credits' FROM public.usage_logs WHERE id = v_log) <> '12'
     OR (SELECT count(*) FROM public.credit_transactions WHERE job_id = '00000000-0000-4000-8000-000000055131' AND source = 'refund' AND amount = 12) <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAIL: policy refund effects';
  END IF;
  IF public.refund_settled_metered_charge(v_log, '00000000-0000-4000-8000-000000055131') <> 'not-committed' THEN
    RAISE EXCEPTION 'ASSERT FAIL: policy refund twice';
  END IF;
  -- Never a side log; never a completed job.
  r := public.reserve_llm_side_hold('00000000-0000-4000-8000-000000055101',4,'00000000-0000-4000-8000-000000055115','image-to-text:claude-sonnet-5.5','take:31');
  v_side := (r->>'usageLogId')::uuid;
  PERFORM public.commit_credits_metered(v_side, 3);
  IF public.refund_settled_metered_charge(v_side, '00000000-0000-4000-8000-000000055115') <> 'not-committed' THEN
    RAISE EXCEPTION 'ASSERT FAIL: a side log reversed as a job charge';
  END IF;
  v_done := public.reserve_credits('00000000-0000-4000-8000-000000055102', 5, '00000000-0000-4000-8000-000000055132', 'llm-chat:claude-sonnet-5.5');
  PERFORM public.commit_credits_metered(v_done, 5);
  UPDATE public.jobs SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000055132';
  IF public.refund_settled_metered_charge(v_done, '00000000-0000-4000-8000-000000055132') <> 'job-live' THEN
    RAISE EXCEPTION 'ASSERT FAIL: a completed job''s charge was refunded';
  END IF;
  RAISE NOTICE 'ok R61: a refused job''s own settled charge is reversed once, its own log only, never a completed job''s';
END $$;

RESET ROLE;

-- 13. Grants: the reversal functions run for the service role only.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.refund_settled_metered_charge('00000000-0000-4000-8000-000000055101','00000000-0000-4000-8000-000000055131');
  RAISE EXCEPTION 'ASSERT FAIL: authenticated policy refund';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok policy refund direct execution denied'; END $$;
DO $$ BEGIN
  PERFORM public.reverse_settled_llm_charge('00000000-0000-4000-8000-000000055101','00000000-0000-4000-8000-000000055131','x','y');
  RAISE EXCEPTION 'ASSERT FAIL: authenticated reversal';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok reversal direct execution denied'; END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
