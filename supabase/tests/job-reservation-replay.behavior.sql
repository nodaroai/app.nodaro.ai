-- Run after the complete migration chain. Every fixture rolls back.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-00000000bc01','reservation-owner@example.test'),
 ('00000000-0000-4000-8000-00000000bc02','reservation-other@example.test');
UPDATE public.profiles SET subscription_credits=1000, topup_credits=0,
 daily_spent_credits=0, lifetime_topup_credits=1 WHERE id IN
 ('00000000-0000-4000-8000-00000000bc01','00000000-0000-4000-8000-00000000bc02');
INSERT INTO public.jobs(id,user_id,status) VALUES
 ('00000000-0000-4000-8000-00000000bc03','00000000-0000-4000-8000-00000000bc01','pending'),
 ('00000000-0000-4000-8000-00000000bc04','00000000-0000-4000-8000-00000000bc01','pending'),
 ('00000000-0000-4000-8000-00000000bc05','00000000-0000-4000-8000-00000000bc01','cancelled');
CREATE FUNCTION pg_temp.assert_reservation_refused(statement text, prefix text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF position(prefix IN SQLERRM)=1 THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'ASSERT FAIL: expected refusal %',prefix;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc03','test-render');
 RAISE EXCEPTION 'ASSERT FAIL: anonymous reservation succeeded';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok anonymous execution denied'; END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc03','test-render');
 RAISE EXCEPTION 'ASSERT FAIL: authenticated reservation succeeded';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok direct authenticated execution denied'; END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 a:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc03','test-render',p_watermark=>true);
 b:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc03','test-render',p_watermark=>false);
 IF a->>'usageLogId' IS DISTINCT FROM b->>'usageLogId' OR a->>'replayed'<>'false' OR b->>'replayed'<>'true'
  OR b->>'watermark'<>'true' THEN RAISE EXCEPTION 'ASSERT FAIL: replay identity/watermark'; END IF;
 IF (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bc01')<>900
  OR (SELECT count(*) FROM public.usage_logs WHERE job_id='00000000-0000-4000-8000-00000000bc03')<>1
  OR (SELECT count(*) FROM public.credit_transactions WHERE job_id='00000000-0000-4000-8000-00000000bc03')<>1
  OR (SELECT usage_log_id::text FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000bc03') IS DISTINCT FROM a->>'usageLogId'
 THEN RAISE EXCEPTION 'ASSERT FAIL: duplicate debit or incomplete receipt'; END IF;
 RAISE NOTICE 'ok exactly one debit, usage receipt, job pointer and ledger';
END $$;
SELECT pg_temp.assert_reservation_refused($s$SELECT public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',101,'00000000-0000-4000-8000-00000000bc03','test-render')$s$,'JOB_RESERVATION_CONFLICT:');
SELECT pg_temp.assert_reservation_refused($s$SELECT public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc03','other-model')$s$,'JOB_RESERVATION_CONFLICT:');
SELECT pg_temp.assert_reservation_refused($s$SELECT public.reserve_job_credits('00000000-0000-4000-8000-00000000bc02',100,'00000000-0000-4000-8000-00000000bc03','test-render')$s$,'JOB_RESERVATION_INACTIVE:');
SELECT pg_temp.assert_reservation_refused($s$SELECT public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc05','test-render')$s$,'JOB_RESERVATION_INACTIVE:');
SELECT pg_temp.assert_reservation_refused($s$SELECT public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',2000,'00000000-0000-4000-8000-00000000bc04','test-render')$s$,'Insufficient credits:');
UPDATE public.usage_logs SET status='refunded' WHERE job_id='00000000-0000-4000-8000-00000000bc03';
SELECT pg_temp.assert_reservation_refused($s$SELECT public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc03','test-render')$s$,'JOB_RESERVATION_CONFLICT:');
RESET ROLE;
CREATE FUNCTION pg_temp.reject_reservation_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.job_id='00000000-0000-4000-8000-00000000bc04' THEN RAISE EXCEPTION 'TEST_LEDGER_FAILURE'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER reservation_ledger_failure BEFORE INSERT ON public.credit_transactions FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_reservation_ledger();
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_reservation_refused($s$SELECT public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc04','test-render')$s$,'TEST_LEDGER_FAILURE');
DO $$ BEGIN
 IF (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bc01')<>900
  OR EXISTS(SELECT 1 FROM public.usage_logs WHERE job_id='00000000-0000-4000-8000-00000000bc04')
  OR (SELECT usage_log_id FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000bc04') IS NOT NULL
 THEN RAISE EXCEPTION 'ASSERT FAIL: partial reservation survived ledger failure'; END IF;
 RAISE NOTICE 'ok ledger failure rolls back debit, receipt and job pointer';
END $$;
RESET ROLE;

INSERT INTO public.jobs(id,user_id,status) VALUES
 ('00000000-0000-4000-8000-00000000bc06','00000000-0000-4000-8000-00000000bc02','pending');
SET LOCAL ROLE service_role;
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 a:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc06','test-delegated',p_on_behalf_of=>'00000000-0000-4000-8000-00000000bc02');
 b:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bc01',100,'00000000-0000-4000-8000-00000000bc06','test-delegated',p_on_behalf_of=>'00000000-0000-4000-8000-00000000bc02');
 IF a->>'usageLogId' IS DISTINCT FROM b->>'usageLogId'
  OR (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bc01')<>800
  OR (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bc02')<>1000
 THEN RAISE EXCEPTION 'ASSERT FAIL: delegated payer replay'; END IF;
 RAISE NOTICE 'ok delegated requester owns the job, payer debited once';
END $$;
RESET ROLE;
ROLLBACK;
