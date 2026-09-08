-- Atomic reservation replay must preserve the workspace payer and member cap.
-- Run after the full migration chain; every fixture rolls back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-00000000bd01','reservation-org-owner@example.test'),
 ('00000000-0000-4000-8000-00000000bd02','reservation-org-member@example.test');
UPDATE public.profiles SET subscription_credits=700, topup_credits=300, daily_spent_credits=0
 WHERE id='00000000-0000-4000-8000-00000000bd02';
INSERT INTO public.organizations(id,slug,name,kind,owner_user_id,status,settings) VALUES
 ('a0000000-0000-4000-8000-00000000bd01','reservation-replay-org','Reservation Org','school',
  '00000000-0000-4000-8000-00000000bd01','active','{}');
INSERT INTO public.workspaces(id,org_id,name,slug) VALUES
 ('b0000000-0000-4000-8000-00000000bd01','a0000000-0000-4000-8000-00000000bd01','Reservation WS','reservation-ws');
INSERT INTO public.organization_members(org_id,user_id,role,status) VALUES
 ('a0000000-0000-4000-8000-00000000bd01','00000000-0000-4000-8000-00000000bd01','owner','active'),
 ('a0000000-0000-4000-8000-00000000bd01','00000000-0000-4000-8000-00000000bd02','member','active');
INSERT INTO public.workspace_members(workspace_id,org_id,user_id,role,status,credit_cap) VALUES
 ('b0000000-0000-4000-8000-00000000bd01','a0000000-0000-4000-8000-00000000bd01',
  '00000000-0000-4000-8000-00000000bd02','member','active',150);
SELECT public.grant_org_credits_idempotent('a0000000-0000-4000-8000-00000000bd01',1000,'cs_reservation_replay_org','org_purchase',25.00);
SELECT public.allocate_workspace_credits('a0000000-0000-4000-8000-00000000bd01',
 'b0000000-0000-4000-8000-00000000bd01',500,'00000000-0000-4000-8000-00000000bd01');
INSERT INTO public.jobs(id,user_id,status,workspace_id,org_id) VALUES
 ('00000000-0000-4000-8000-00000000bd03','00000000-0000-4000-8000-00000000bd02','pending',
  'b0000000-0000-4000-8000-00000000bd01','a0000000-0000-4000-8000-00000000bd01'),
 ('00000000-0000-4000-8000-00000000bd04','00000000-0000-4000-8000-00000000bd02','pending',
  'b0000000-0000-4000-8000-00000000bd01','a0000000-0000-4000-8000-00000000bd01');
SET LOCAL ROLE service_role;
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 a:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bd02',100,
  '00000000-0000-4000-8000-00000000bd03','workspace-render',p_workspace_id=>'b0000000-0000-4000-8000-00000000bd01');
 b:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bd02',100,
  '00000000-0000-4000-8000-00000000bd03','workspace-render',p_workspace_id=>'b0000000-0000-4000-8000-00000000bd01');
 IF a->>'usageLogId' IS DISTINCT FROM b->>'usageLogId' OR b->>'replayed'<>'true'
  OR (SELECT reserved_credits FROM public.workspace_budgets WHERE workspace_id='b0000000-0000-4000-8000-00000000bd01')<>100
  OR (SELECT reserved_credits FROM public.workspace_member_spend WHERE workspace_id='b0000000-0000-4000-8000-00000000bd01'
      AND user_id='00000000-0000-4000-8000-00000000bd02')<>100
  OR (SELECT subscription_credits+topup_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bd02')<>1000
  OR (SELECT daily_spent_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bd02')<>0
  OR (SELECT count(*) FROM public.usage_logs WHERE job_id='00000000-0000-4000-8000-00000000bd03')<>1
  OR (SELECT count(*) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-00000000bd03'
      AND source='org_usage' AND credit_type='org' AND amount=-100
      AND org_id='a0000000-0000-4000-8000-00000000bd01'
      AND workspace_id='b0000000-0000-4000-8000-00000000bd01')<>1
 THEN RAISE EXCEPTION 'ASSERT FAIL: workspace replay changed payer, budget, cap or ledger'; END IF;
 RAISE NOTICE 'ok workspace and capped member reserve once; personal balance untouched';
END $$;
DO $$ BEGIN
 BEGIN
  PERFORM public.reserve_job_credits('00000000-0000-4000-8000-00000000bd02',60,
   '00000000-0000-4000-8000-00000000bd04','workspace-render',p_workspace_id=>'b0000000-0000-4000-8000-00000000bd01');
  RAISE EXCEPTION 'ASSERT FAIL: member cap bypassed';
 EXCEPTION WHEN OTHERS THEN
  IF position('MEMBER_CAP_EXCEEDED' IN SQLERRM)<>1 THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.usage_logs WHERE job_id='00000000-0000-4000-8000-00000000bd04')
  OR (SELECT usage_log_id FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000bd04') IS NOT NULL
  OR (SELECT reserved_credits FROM public.workspace_budgets WHERE workspace_id='b0000000-0000-4000-8000-00000000bd01')<>100
 THEN RAISE EXCEPTION 'ASSERT FAIL: failed capped reserve left partial state'; END IF;
 RAISE NOTICE 'ok capped reservation rolls back atomically';
END $$;
DO $$ BEGIN
 PERFORM public.reserve_job_credits('00000000-0000-4000-8000-00000000bd02',100,
  '00000000-0000-4000-8000-00000000bd03','workspace-render');
 RAISE EXCEPTION 'ASSERT FAIL: workspace replay changed to personal payer';
EXCEPTION WHEN SQLSTATE '55021' THEN RAISE NOTICE 'ok workspace cannot replay as personal'; END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
