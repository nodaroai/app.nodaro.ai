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
DO $$ DECLARE held jsonb; log_id uuid; result jsonb; BEGIN
 held:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bd02',100,
  '00000000-0000-4000-8000-00000000bd03','workspace-render',p_workspace_id=>'b0000000-0000-4000-8000-00000000bd01');
 log_id:=(held->>'usageLogId')::uuid;
 UPDATE public.jobs SET status='completed' WHERE id='00000000-0000-4000-8000-00000000bd03';
 PERFORM public.settle_job_reservation('00000000-0000-4000-8000-00000000bd03','00000000-0000-4000-8000-00000000bd02',log_id,'completed',40,repeat('f',64));
 result:=public.settle_job_reservation('00000000-0000-4000-8000-00000000bd03','00000000-0000-4000-8000-00000000bd02',log_id,'completed',40,repeat('f',64));
 IF result->>'replayed'<>'true'
  OR (SELECT reserved_credits FROM public.workspace_budgets WHERE workspace_id='b0000000-0000-4000-8000-00000000bd01')<>0
  OR (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id='b0000000-0000-4000-8000-00000000bd01')<>40
  OR (SELECT reserved_credits FROM public.workspace_member_spend WHERE workspace_id='b0000000-0000-4000-8000-00000000bd01'
      AND user_id='00000000-0000-4000-8000-00000000bd02')<>0
  OR (SELECT spent_credits FROM public.workspace_member_spend WHERE workspace_id='b0000000-0000-4000-8000-00000000bd01'
      AND user_id='00000000-0000-4000-8000-00000000bd02')<>40
  OR (SELECT subscription_credits+topup_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bd02')<>1000
  OR (SELECT sum(amount) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-00000000bd03')<>-40
  OR (SELECT count(*) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-00000000bd03')<>2
 THEN RAISE EXCEPTION 'ASSERT FAIL: workspace settlement, cap, personal balance or ledger'; END IF;
 RAISE NOTICE 'ok workspace settlement exactly once with personal balance untouched';
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
