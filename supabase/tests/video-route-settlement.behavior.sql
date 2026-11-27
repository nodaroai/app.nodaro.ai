-- Verify a retry across each boundary on a real ledger. All fixtures roll back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000071601','routed-delivery@example.test');
UPDATE public.profiles SET subscription_credits=120,topup_credits=0,daily_spent_credits=0,lifetime_topup_credits=1
 WHERE id='00000000-0000-4000-8000-000000071601';
INSERT INTO public.jobs(id,user_id,status,metadata) VALUES
 ('00000000-0000-4000-8000-000000071602','00000000-0000-4000-8000-000000071601','pending','{"other":"keep"}'),
 ('00000000-0000-4000-8000-000000071603','00000000-0000-4000-8000-000000071601','pending',null),
 ('00000000-0000-4000-8000-000000071604','00000000-0000-4000-8000-000000071601','pending',null),
 ('00000000-0000-4000-8000-000000071605','00000000-0000-4000-8000-000000071601','pending',null);

DO $$
DECLARE f regprocedure; r text;
BEGIN
  FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE proname IN ('reserve_video_route_credits','prepare_video_route_run','commit_video_route_credits') LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(r,f,'execute') THEN RAISE EXCEPTION 'Unexpected execute grant on % to %',f,r; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role',f,'execute') THEN RAISE EXCEPTION 'Missing service role grant'; END IF;
  END LOOP;
  -- A debt is never deleted, and a repayment is never changed or deleted, by anyone but the owner.
  IF has_table_privilege('service_role','public.video_route_debts','DELETE') OR has_table_privilege('service_role','public.video_route_debts','TRUNCATE')
    OR has_table_privilege('service_role','public.video_route_repayments','UPDATE') OR has_table_privilege('service_role','public.video_route_repayments','DELETE')
    OR has_table_privilege('service_role','public.video_route_repayments','TRUNCATE') THEN RAISE EXCEPTION 'The server can remove or rewrite the debt record'; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(r,'public.video_route_debts','SELECT') OR has_table_privilege(r,'public.video_route_repayments','SELECT')
      OR has_table_privilege(r,'public.video_route_deferred_repayments','SELECT') OR has_table_privilege(r,'public.video_route_ledger','SELECT') THEN
      RAISE EXCEPTION 'A client role can read the routed money tables';
    END IF;
    -- The schema's default privileges open every new sequence to the client roles.
    IF has_sequence_privilege(r,'public.video_route_ledger_id_seq','USAGE') OR has_sequence_privilege(r,'public.video_route_ledger_id_seq','SELECT')
      OR has_sequence_privilege(r,'public.video_route_ledger_id_seq','UPDATE')
      OR has_sequence_privilege(r,'public.video_route_deferred_repayments_id_seq','USAGE') OR has_sequence_privilege(r,'public.video_route_deferred_repayments_id_seq','SELECT')
      OR has_sequence_privilege(r,'public.video_route_deferred_repayments_id_seq','UPDATE') THEN
      RAISE EXCEPTION 'A client role can use a routed money sequence';
    END IF;
  END LOOP;
  -- The retry locks the notes it takes (FOR UPDATE needs UPDATE) and records a failed try.
  IF NOT has_table_privilege('service_role','public.video_route_deferred_repayments','UPDATE')
    OR NOT has_sequence_privilege('service_role','public.video_route_deferred_repayments_id_seq','USAGE')
    OR NOT has_sequence_privilege('service_role','public.video_route_ledger_id_seq','USAGE') THEN
    RAISE EXCEPTION 'The server cannot retry a deferred repayment';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;
-- As this environment's server calls: the service role, naming its environment.
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
SET LOCAL request.headers = '{"x-nodaro-env":"test"}';
DO $$
DECLARE
  uid uuid := '00000000-0000-4000-8000-000000071601';
  jid uuid := '00000000-0000-4000-8000-000000071602';
  other_job uuid := '00000000-0000-4000-8000-000000071603';
  dormant_job uuid := '00000000-0000-4000-8000-000000071604';
  elsewhere_job uuid := '00000000-0000-4000-8000-000000071605';
  lid uuid;
  result jsonb;
  receipt jsonb;
BEGIN
  result := public.reserve_video_route_credits(uid,100,jid,'ugc-clip','original','test');
  lid := (result->>'usageLogId')::uuid;
  result := public.reserve_video_route_credits(uid,100,jid,'ugc-clip','later-bound-token','test');
  IF result->>'routedRunToken' IS DISTINCT FROM 'original' OR result->'replayed' IS DISTINCT FROM 'true'::jsonb
    OR (SELECT count(*) FROM public.usage_logs WHERE job_id = jid) <> 1
    OR (SELECT subscription_credits FROM public.profiles WHERE id = uid) <> 20
    OR (SELECT metadata->>'reservation_mode' FROM public.usage_logs WHERE id = lid) IS DISTINCT FROM 'video-route'
    THEN RAISE EXCEPTION 'Duplicate debit or incorrect replay'; END IF;
  BEGIN
    UPDATE public.jobs SET status='completed' WHERE id=jid;
    RAISE EXCEPTION 'Unprepared publication succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Routed run delivery was not prepared' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.commit_video_route_credits(lid,other_job,100);
    RAISE EXCEPTION 'Unrelated job was charged';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Routed credits require a delivered job and its reservation' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.commit_video_route_credits(lid,jid,100);
    RAISE EXCEPTION 'Undelivered job was charged';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Routed credits require a delivered job and its reservation' THEN RAISE; END IF;
  END;
  PERFORM public.prepare_video_route_run(jid,uid,lid,'ugc-clip',100,'original','test','{"waiveFee":false}');
  PERFORM public.prepare_video_route_run(jid,uid,lid,'ugc-clip',100,'original','test','{"waiveFee":true}');
  result := public.prepare_video_route_run(jid,uid,lid,'ugc-clip',100,'original','test','{"waiveFee":false}');
  IF result->'opts'->'waiveFee' IS DISTINCT FROM 'true'::jsonb OR
     (SELECT metadata->>'other' FROM public.jobs WHERE id=jid) IS DISTINCT FROM 'keep' OR
     (SELECT state FROM public.video_route_ledger WHERE job_id=jid AND kind='settle') IS DISTINCT FROM 'retry'
     THEN RAISE EXCEPTION 'Missing prepared marker or mutable waiver'; END IF;
  UPDATE public.jobs SET status='completed' WHERE id=jid;
  receipt := public.commit_video_route_credits(lid,jid,500);
  IF receipt->'charged' IS DISTINCT FROM '120'::jsonb OR receipt->'shortfall' IS DISTINCT FROM '380'::jsonb OR
     public.commit_video_route_credits(lid,jid,500) IS DISTINCT FROM receipt OR
     (SELECT metadata->'videoRouteReceipt' FROM public.usage_logs WHERE id=lid) IS DISTINCT FROM receipt OR
     (SELECT subscription_credits FROM public.profiles WHERE id=uid) <> 0 THEN RAISE EXCEPTION 'Incorrect charge, shortfall or replay'; END IF;
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid) IS DISTINCT FROM 380 THEN RAISE EXCEPTION 'Missing original shortfall'; END IF;
  -- DORMANT (the shipped state: this environment has not turned enforcement on).
  -- The unpaid charge is recorded, and nothing else changes: a paid run is
  -- admitted, and new funding stays the payer's.
  IF public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'Enforcement is on with nothing saved'; END IF;
  UPDATE public.profiles SET subscription_credits=5 WHERE id=uid;
  PERFORM public.reserve_job_credits(uid,1,dormant_job,'test-render');
  result := public.admin_adjust_credits(uid,'topup_credits',3)::jsonb;
  IF result->'topup_credits' IS DISTINCT FROM '3'::jsonb OR
     (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>380 OR
     (SELECT pool_remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>380 OR
     (SELECT credits_charged FROM public.usage_logs WHERE id=lid)<>120 OR
     EXISTS(SELECT 1 FROM public.video_route_repayments WHERE usage_log_id=lid)
     THEN RAISE EXCEPTION 'A dormant debt collected from new funding'; END IF;
  PERFORM public.admin_adjust_credits(uid,'topup_credits',-3);
  UPDATE public.profiles SET subscription_credits=0 WHERE id=uid;
  -- Another environment turning it on changes nothing here.
  INSERT INTO public.app_settings(key,value) VALUES('video_route_policy:elsewhere','{"enforceUnpaidCharges":true}');
  IF public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'Enforcement leaked across environments'; END IF;
  -- ENFORCED from here: an admin turned it on for this environment.
  INSERT INTO public.app_settings(key,value) VALUES('video_route_policy:test','{"enforceUnpaidCharges":true}');
  IF NOT public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'Saved enforcement is not read'; END IF;
  BEGIN
    PERFORM public.reserve_job_credits(uid,1,other_job,'test-render');
    RAISE EXCEPTION 'Outstanding debt did not block a paid reservation';
  EXCEPTION WHEN OTHERS THEN
    -- A zero balance may be refused by the legacy reserve before insertion.
    IF SQLERRM NOT LIKE 'ROUTED_BALANCE_DUE:%' AND SQLERRM NOT LIKE 'Insufficient credits%' THEN RAISE; END IF;
  END;
  result := public.admin_adjust_credits(uid,'topup_credits',125)::jsonb;
  IF result->'topup_credits' IS DISTINCT FROM '0'::jsonb OR
     (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>255 OR
     (SELECT credits_charged FROM public.usage_logs WHERE id=lid)<>245 OR
     (SELECT topup_credits FROM public.profiles WHERE id=uid)<>0 THEN RAISE EXCEPTION 'Partial repayment did not charge exactly the funding'; END IF;
  UPDATE public.profiles SET subscription_credits=10 WHERE id=uid;
  BEGIN
    PERFORM public.reserve_job_credits(uid,1,other_job,'test-render');
    RAISE EXCEPTION 'An outstanding debit allowed a new paid reservation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'ROUTED_BALANCE_DUE:%' THEN RAISE; END IF;
  END;
  -- SCOPED TO ITS ENVIRONMENT. Another environment's server (which enforces
  -- its own debts) shares this database: this debt neither blocks that
  -- environment's run nor takes that environment's top-up.
  PERFORM set_config('request.headers','{"x-nodaro-env":"elsewhere"}',true);
  IF public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'A debt is enforced for another environment''s request'; END IF;
  PERFORM public.reserve_job_credits(uid,1,elsewhere_job,'test-render');
  result := public.admin_adjust_credits(uid,'topup_credits',4)::jsonb;
  IF result->'topup_credits' IS DISTINCT FROM '4'::jsonb OR
     (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>255 THEN RAISE EXCEPTION 'Another environment''s funding repaid this debt'; END IF;
  PERFORM public.admin_adjust_credits(uid,'topup_credits',-4);
  -- A request that names no environment, or is not the service role's, enforces nothing.
  PERFORM set_config('request.headers','{}',true);
  IF public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'Enforced with no environment named'; END IF;
  PERFORM set_config('request.headers','{"x-nodaro-env":"test"}',true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  IF public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'A client named its own environment'; END IF;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  IF NOT public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'Enforcement lost for its own environment'; END IF;
  -- Settings that are not JSON name no environment: nothing is enforced, and nothing fails.
  PERFORM set_config('request.headers','not json',true);
  IF public.video_route_request_env() IS NOT NULL OR public.video_route_debt_enforced('test') THEN RAISE EXCEPTION 'A malformed header named an environment'; END IF;
  PERFORM set_config('request.headers','{"x-nodaro-env":"test"}',true);
  PERFORM set_config('request.jwt.claims','{not json',true);
  IF public.video_route_request_env() IS NOT NULL THEN RAISE EXCEPTION 'Malformed claims named an environment'; END IF;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  -- Another transaction can grant system credits after this transaction's
  -- now(), but before its purchase. Its timestamp must never choose what paid.
  PERFORM public.add_topup_credits(uid,2);
  UPDATE public.topup_grants SET granted_at=now()+interval '1 second'
    WHERE user_id=uid AND source='system' AND amount=2;
  IF NOT public.grant_topup_credits_idempotent(uid,300,'video-route-repayment-test',1) THEN
    RAISE EXCEPTION 'Purchase grant was not recorded'; END IF;
  IF public.grant_topup_credits_idempotent(uid,300,'video-route-repayment-test',1) THEN
    RAISE EXCEPTION 'Payment replay granted credits twice'; END IF;
  PERFORM public.sync_video_route_debt(lid,jid);
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>0 OR
     (SELECT credits_charged FROM public.usage_logs WHERE id=lid)<>500 OR
     (SELECT credits_actual FROM public.jobs WHERE id=jid)<>500 OR
     (SELECT state FROM public.video_route_ledger WHERE job_id=jid AND kind='settle')<>'done' OR
     (SELECT topup_credits FROM public.profiles WHERE id=uid)<>47 OR
     NOT EXISTS(SELECT 1 FROM public.topup_grants WHERE user_id=uid AND source='system' AND amount=2) OR
     NOT EXISTS(SELECT 1 FROM public.topup_grants WHERE user_id=uid AND source='purchase' AND amount=300) OR
     (SELECT count(*) FROM public.video_route_repayments WHERE usage_log_id=lid)<>2 THEN RAISE EXCEPTION 'Incorrect final repayment'; END IF;
  PERFORM public.reserve_job_credits(uid,1,other_job,'test-render');
END;
$$;
-- Recovery is keyed to the immutable receipt, even after job/usage retention.
DO $$
DECLARE uid uuid:='00000000-0000-4000-8000-000000071601'; jid uuid:=gen_random_uuid();
  lid uuid:=gen_random_uuid(); response jsonb;
BEGIN
  INSERT INTO public.video_route_debts(usage_log_id,job_id,env,user_id,requester_id,payer,original_shortfall,
    requested,verified_charged,remaining,pool_remaining,allowance_enforced,member_spend)
    VALUES(lid,jid,'test',uid,uid,'external_wallet',20,30,10,20,20,false,false);
  INSERT INTO public.external_wallet_operations(usage_log_id,requester_id,job_id,provider,sso_subject,model_identifier,reserved_credits,actual_credits,authorized_at,delivered_at)
    VALUES(lid,uid,jid,'test-wallet','customer','test-render',10,10,now(),now());
  response:=public.repay_external_video_route_debt(lid,'test-wallet','payment-1',7);
  -- A replay answers with what was recorded even after enforcement is switched off; a NEW payment is refused then.
  UPDATE public.app_settings SET value='{"enforceUnpaidCharges":false}' WHERE key='video_route_policy:test';
  IF public.repay_external_video_route_debt(lid,'test-wallet','payment-1',7)<>response THEN RAISE EXCEPTION 'A replay was refused after enforcement was switched off'; END IF;
  BEGIN
    PERFORM public.repay_external_video_route_debt(lid,'test-wallet','payment-off',1);
    RAISE EXCEPTION 'A new payment was taken with enforcement off';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Unpaid video charges are not enforced in this environment' THEN RAISE; END IF; END;
  UPDATE public.app_settings SET value='{"enforceUnpaidCharges":true}' WHERE key='video_route_policy:test';
  IF response->'remaining'<>'13'::jsonb OR public.repay_external_video_route_debt(lid,'test-wallet','payment-1',7)<>response
    OR (SELECT pool_remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>20 THEN RAISE EXCEPTION 'Duplicate or mixed wallet payment'; END IF;
  BEGIN
    PERFORM public.repay_external_video_route_debt(lid,'test-wallet','payment-1',8);
    RAISE EXCEPTION 'Conflicting external payment was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Conflicting external recovery receipt' THEN RAISE; END IF; END;
  UPDATE public.profiles SET topup_credits=topup_credits+20 WHERE id=uid;
  INSERT INTO public.topup_grants(user_id,amount,source,expires_at) VALUES(uid,20,'admin',now()+interval '1 year');
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>13 OR
     (SELECT pool_remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>0 THEN RAISE EXCEPTION 'Pool incorrectly paid customer wallet'; END IF;
  PERFORM public.repay_external_video_route_debt(lid,'test-wallet','payment-2',13);
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>0 OR EXISTS(SELECT 1 FROM public.jobs WHERE id=jid)
     OR EXISTS(SELECT 1 FROM public.video_route_ledger WHERE job_id=jid) THEN RAISE EXCEPTION 'Purged-job wallet evidence did not settle'; END IF;
END;
$$;
-- A deployment allowance and a workspace allocation constrain different pools.
DO $$
DECLARE uid uuid := '00000000-0000-4000-8000-000000071601';
  lid uuid := gen_random_uuid(); jid uuid := gen_random_uuid(); org uuid := gen_random_uuid(); ws uuid := gen_random_uuid();
  r jsonb; pool_lid uuid; balance integer;
BEGIN
  INSERT INTO public.deployment_user_allowances(user_id,granted_credits,reserved_credits,spent_credits)
    VALUES(uid,5,0,5) ON CONFLICT(user_id) DO UPDATE SET granted_credits=5,reserved_credits=0,spent_credits=5;
  INSERT INTO public.video_route_debts(usage_log_id,job_id,env,user_id,requester_id,payer,original_shortfall,
    requested,verified_charged,remaining,pool_remaining,allowance_enforced,member_spend)
    VALUES(lid,jid,'test',uid,uid,'deployment',9,19,10,9,9,true,false);
  PERFORM public.admin_adjust_credits(uid,'topup_credits',20);
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>9 THEN RAISE EXCEPTION 'Bypassed deployment allowance'; END IF;
  UPDATE public.deployment_user_allowances SET granted_credits=14 WHERE user_id=uid;
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>0 OR
     (SELECT spent_credits FROM public.deployment_user_allowances WHERE user_id=uid)<>14 THEN RAISE EXCEPTION 'Allowance funding failed to collect'; END IF;
  INSERT INTO public.organizations(id,slug,name,kind,owner_user_id,status,settings) VALUES(org,'video-route-sql','Route test','school',uid,'active','{}');
  INSERT INTO public.workspaces(id,org_id,name,slug) VALUES(ws,org,'Route test','video-route-sql');
  INSERT INTO public.workspace_budgets(workspace_id,allocated_credits,reserved_credits,spent_credits)
    VALUES(ws,40,0,40) ON CONFLICT(workspace_id) DO UPDATE SET allocated_credits=40,reserved_credits=0,spent_credits=40;
  lid:=gen_random_uuid(); jid:=gen_random_uuid();
  INSERT INTO public.video_route_debts(usage_log_id,job_id,env,user_id,workspace_id,org_id,payer,original_shortfall,
    requested,verified_charged,remaining,pool_remaining,allowance_enforced,member_spend)
    VALUES(lid,jid,'test',uid,ws,org,'workspace',30,70,40,30,0,false,false);
  UPDATE public.workspace_budgets SET allocated_credits=60 WHERE workspace_id=ws;
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>10 OR
     (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id=ws)<>60 THEN RAISE EXCEPTION 'Incorrect partial workspace collection'; END IF;
  UPDATE public.workspace_budgets SET allocated_credits=90 WHERE workspace_id=ws;
  IF (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>0 OR
     (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id=ws)<>70 THEN RAISE EXCEPTION 'Incorrect workspace collection'; END IF;

  -- THE RETRY OF A DEFERRED REPAYMENT, as the server runs it (the service
  -- role). With nothing noted it answers zeros (it must be able to lock an
  -- empty table).
  r := public.retry_deferred_video_repayments();
  IF r IS DISTINCT FROM '{"applied":0,"credits":0,"dropped":0,"failed":0,"stuck":0}'::jsonb THEN RAISE EXCEPTION 'An empty retry answered %',r; END IF;
  -- A workspace note takes only the budget's headroom (5 of the 20 noted, of
  -- 30 owed): the budget's own limit is never passed, the rest stays owed.
  lid:=gen_random_uuid(); jid:=gen_random_uuid();
  INSERT INTO public.video_route_debts(usage_log_id,job_id,env,user_id,workspace_id,org_id,payer,original_shortfall,
    requested,verified_charged,remaining,pool_remaining,allowance_enforced,member_spend)
    VALUES(lid,jid,'test',uid,ws,org,'workspace',30,70,40,30,0,false,false);
  UPDATE public.workspace_budgets SET spent_credits=85 WHERE workspace_id=ws;
  INSERT INTO public.video_route_deferred_repayments(env,kind,workspace_id,available,source,receipt_id) VALUES('test','workspace',ws,20,'allocation','deferred-1');
  r := public.retry_deferred_video_repayments();
  IF r->'applied'<>'1'::jsonb OR r->'credits'<>'5'::jsonb OR
     (SELECT remaining FROM public.video_route_debts WHERE usage_log_id=lid)<>25 OR
     (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id=ws)<>90 OR
     EXISTS(SELECT 1 FROM public.video_route_deferred_repayments WHERE workspace_id=ws) THEN RAISE EXCEPTION 'A deferred workspace repayment passed the headroom, or was not applied: %',r; END IF;
  -- No headroom at all: nothing is taken and nothing fails; the note stays,
  -- with the try and its reason, and a later note still runs in the same call.
  INSERT INTO public.video_route_deferred_repayments(env,kind,workspace_id,available,source,receipt_id) VALUES('test','workspace',ws,20,'allocation','deferred-2');
  pool_lid:=gen_random_uuid();
  INSERT INTO public.video_route_debts(usage_log_id,job_id,env,user_id,requester_id,payer,original_shortfall,
    requested,verified_charged,remaining,pool_remaining,allowance_enforced,member_spend)
    VALUES(pool_lid,gen_random_uuid(),'test',uid,uid,'personal',4,4,0,4,4,false,false);
  SELECT topup_credits INTO balance FROM public.profiles WHERE id=uid;
  UPDATE public.profiles SET topup_credits=topup_credits+4 WHERE id=uid;
  INSERT INTO public.video_route_deferred_repayments(env,kind,user_id,available,source,receipt_id) VALUES('test','pool',uid,4,'topup','deferred-3');
  r := public.retry_deferred_video_repayments();
  IF r->'applied'<>'1'::jsonb OR r->'credits'<>'4'::jsonb OR r->'failed'<>'1'::jsonb OR
     (SELECT pool_remaining FROM public.video_route_debts WHERE usage_log_id=pool_lid)<>0 OR
     (SELECT topup_credits FROM public.profiles WHERE id=uid)<>balance OR
     (SELECT spent_credits FROM public.workspace_budgets WHERE workspace_id=ws)<>90 OR
     (SELECT attempts FROM public.video_route_deferred_repayments WHERE receipt_id='deferred-2')<>1 OR
     (SELECT last_error IS NULL OR last_attempt_at IS NULL FROM public.video_route_deferred_repayments WHERE receipt_id='deferred-2')
     THEN RAISE EXCEPTION 'A note that could take nothing was lost, or held back the next: %',r; END IF;
  -- After ten failed tries it is left for an admin: counted, never tried again.
  UPDATE public.video_route_deferred_repayments SET attempts=10 WHERE receipt_id='deferred-2';
  r := public.retry_deferred_video_repayments();
  IF r->'stuck'<>'1'::jsonb OR r->'failed'<>'0'::jsonb OR r->'applied'<>'0'::jsonb THEN RAISE EXCEPTION 'A stuck note was tried again: %',r; END IF;
  -- A note whose debt is gone is removed.
  UPDATE public.video_route_deferred_repayments SET attempts=0 WHERE receipt_id='deferred-2';
  UPDATE public.video_route_debts SET remaining=0 WHERE usage_log_id=lid;
  r := public.retry_deferred_video_repayments();
  IF r->'dropped'<>'1'::jsonb OR EXISTS(SELECT 1 FROM public.video_route_deferred_repayments WHERE workspace_id=ws) THEN RAISE EXCEPTION 'A note with nothing left to repay stayed: %',r; END IF;
  -- A debt whose environment could not be told is never enforced, whatever a server calls itself.
  INSERT INTO public.app_settings(key,value) VALUES('video_route_policy:unknown','{"enforceUnpaidCharges":true}');
  PERFORM set_config('request.headers','{"x-nodaro-env":"unknown"}',true);
  IF public.video_route_request_env() IS DISTINCT FROM 'unknown' OR public.video_route_debt_enforced('unknown') THEN RAISE EXCEPTION 'The unknown environment is enforceable'; END IF;
  PERFORM set_config('request.headers','{"x-nodaro-env":"test"}',true);
END;
$$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
