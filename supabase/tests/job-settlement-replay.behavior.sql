-- Exact settlement, replay, ceiling and ledger atomicity on the full schema.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-00000000be01','settlement-owner@example.test'),
 ('00000000-0000-4000-8000-00000000be02','settlement-other@example.test');
UPDATE public.profiles SET subscription_credits=1000,topup_credits=0,daily_spent_credits=0,lifetime_topup_credits=1
 WHERE id='00000000-0000-4000-8000-00000000be01';
INSERT INTO public.jobs(id,user_id,status) VALUES
 ('00000000-0000-4000-8000-00000000be03','00000000-0000-4000-8000-00000000be01','pending'),
 ('00000000-0000-4000-8000-00000000be04','00000000-0000-4000-8000-00000000be01','pending'),
 ('00000000-0000-4000-8000-00000000be05','00000000-0000-4000-8000-00000000be01','pending'),
 ('00000000-0000-4000-8000-00000000be06','00000000-0000-4000-8000-00000000be01','pending');
CREATE FUNCTION pg_temp.expect_settlement_refusal(statement text, prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN IF position(prefix IN SQLERRM)=1 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'ASSERT FAIL: expected settlement refusal %',prefix;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM public.settle_job_reservation(NULL,NULL,NULL,'completed',1,repeat('a',64));
 RAISE EXCEPTION 'ASSERT FAIL: anonymous settlement';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok anonymous execution denied'; END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.settle_job_reservation(NULL,NULL,NULL,'completed',1,repeat('a',64));
 RAISE EXCEPTION 'ASSERT FAIL: authenticated settlement';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok direct authenticated execution denied'; END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE held jsonb; first_result jsonb; replay jsonb; log_id uuid; BEGIN
 held:=public.reserve_job_credits('00000000-0000-4000-8000-00000000be01',100,'00000000-0000-4000-8000-00000000be03','test-render');
 log_id:=(held->>'usageLogId')::uuid;
 PERFORM pg_temp.expect_settlement_refusal(format($s$SELECT public.settle_job_reservation('00000000-0000-4000-8000-00000000be03',
 '00000000-0000-4000-8000-00000000be01',%L,'completed',40,repeat('a',64))$s$,log_id),'JOB_SETTLEMENT_CONFLICT:');
 UPDATE public.jobs SET status='completed' WHERE id='00000000-0000-4000-8000-00000000be03';
 PERFORM pg_temp.expect_settlement_refusal(format($s$SELECT public.settle_job_reservation('00000000-0000-4000-8000-00000000be03',
 '00000000-0000-4000-8000-00000000be02',%L,'completed',40,repeat('a',64))$s$,log_id),'JOB_SETTLEMENT_CONFLICT:');
 PERFORM pg_temp.expect_settlement_refusal(format($s$SELECT public.settle_job_reservation('00000000-0000-4000-8000-00000000be03',
 '00000000-0000-4000-8000-00000000be01',%L,'completed',101,repeat('a',64))$s$,log_id),'JOB_SETTLEMENT_CONFLICT:');
 first_result:=public.settle_job_reservation('00000000-0000-4000-8000-00000000be03','00000000-0000-4000-8000-00000000be01',log_id,'completed',40,repeat('a',64),0.25);
 replay:=public.settle_job_reservation('00000000-0000-4000-8000-00000000be03','00000000-0000-4000-8000-00000000be01',log_id,'completed',40,repeat('a',64),0.25);
 IF first_result->>'replayed'<>'false' OR replay->>'replayed'<>'true' OR replay->>'releasedCredits'<>'60'
  OR (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000be01')<>960
  OR (SELECT credits_charged FROM public.usage_logs WHERE id=log_id)<>40
  OR (SELECT credits_actual FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000be03')<>40
  OR (SELECT provider_cost FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000be03')<>0.25
  OR (SELECT count(*) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-00000000be03')<>2
  OR (SELECT sum(amount) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-00000000be03')<>-40
 THEN RAISE EXCEPTION 'ASSERT FAIL: duplicate or inconsistent final settlement'; END IF;
 PERFORM pg_temp.expect_settlement_refusal(format($s$SELECT public.settle_job_reservation('00000000-0000-4000-8000-00000000be03',
 '00000000-0000-4000-8000-00000000be01',%L,'completed',41,repeat('a',64),0.25)$s$,log_id),'JOB_SETTLEMENT_CONFLICT:');
 PERFORM pg_temp.expect_settlement_refusal(format($s$SELECT public.settle_job_reservation('00000000-0000-4000-8000-00000000be03',
 '00000000-0000-4000-8000-00000000be01',%L,'completed',40,repeat('b',64),0.25)$s$,log_id),'JOB_SETTLEMENT_CONFLICT:');
 RAISE NOTICE 'ok exact settlement and one surplus ledger survive replay';
END $$;
DO $$ DECLARE held jsonb; log_id uuid; BEGIN
 held:=public.reserve_job_credits('00000000-0000-4000-8000-00000000be01',100,'00000000-0000-4000-8000-00000000be04','test-render');
 log_id:=(held->>'usageLogId')::uuid;
 UPDATE public.jobs SET status='cancelled' WHERE id='00000000-0000-4000-8000-00000000be04';
 PERFORM public.settle_job_reservation('00000000-0000-4000-8000-00000000be04','00000000-0000-4000-8000-00000000be01',log_id,'cancelled',25,repeat('c',64));
 IF (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000be01')<>935
  OR (SELECT credits_actual FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000be04')<>25
 THEN RAISE EXCEPTION 'ASSERT FAIL: cancellation eligible work'; END IF;
 held:=public.reserve_job_credits('00000000-0000-4000-8000-00000000be01',100,'00000000-0000-4000-8000-00000000be05','test-render');
 log_id:=(held->>'usageLogId')::uuid;
 UPDATE public.jobs SET status='failed' WHERE id='00000000-0000-4000-8000-00000000be05';
 PERFORM public.settle_job_reservation('00000000-0000-4000-8000-00000000be05','00000000-0000-4000-8000-00000000be01',log_id,'failed',0,repeat('d',64));
 PERFORM public.settle_job_reservation('00000000-0000-4000-8000-00000000be05','00000000-0000-4000-8000-00000000be01',log_id,'failed',0,repeat('d',64));
 IF (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000be01')<>935
  OR (SELECT status FROM public.usage_logs WHERE id=log_id)<>'refunded'
  OR (SELECT credits_charged FROM public.usage_logs WHERE id=log_id)<>0
 THEN RAISE EXCEPTION 'ASSERT FAIL: failed work not fully refunded'; END IF;
 RAISE NOTICE 'ok cancellation partial settlement and service failure full refund';
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.reject_settlement_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.job_id='00000000-0000-4000-8000-00000000be06' AND NEW.source='refund' THEN RAISE EXCEPTION 'TEST_SETTLEMENT_LEDGER_FAILURE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER settlement_ledger_failure BEFORE INSERT ON public.credit_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_settlement_ledger();
SET LOCAL ROLE service_role;
DO $$ DECLARE held jsonb; log_id uuid; BEGIN
 held:=public.reserve_job_credits('00000000-0000-4000-8000-00000000be01',100,'00000000-0000-4000-8000-00000000be06','test-render');
 log_id:=(held->>'usageLogId')::uuid;
 UPDATE public.jobs SET status='completed' WHERE id='00000000-0000-4000-8000-00000000be06';
 PERFORM pg_temp.expect_settlement_refusal(format($s$SELECT public.settle_job_reservation('00000000-0000-4000-8000-00000000be06',
 '00000000-0000-4000-8000-00000000be01',%L,'completed',40,repeat('e',64))$s$,log_id),'TEST_SETTLEMENT_LEDGER_FAILURE');
 IF (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000be01')<>835
  OR (SELECT status FROM public.usage_logs WHERE id=log_id)<>'reserved'
  OR (SELECT metadata ? 'job_settlement' FROM public.usage_logs WHERE id=log_id)
  OR (SELECT credits_actual FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000be06') IS NOT NULL
 THEN RAISE EXCEPTION 'ASSERT FAIL: ledger error left partial settlement'; END IF;
 RAISE NOTICE 'ok ledger failure rolls back money, job amount and settlement receipt';
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
