BEGIN;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-4000-8000-00000000bf01','managed-settlement@example.test');
UPDATE public.profiles SET subscription_credits=1000,topup_credits=0,daily_spent_credits=0,lifetime_topup_credits=1
 WHERE id='00000000-0000-4000-8000-00000000bf01';
INSERT INTO public.jobs(id,user_id,status)
 SELECT ('00000000-0000-4000-8000-00000000bf0'||i)::uuid,'00000000-0000-4000-8000-00000000bf01','pending' FROM generate_series(3,9) i;
CREATE FUNCTION pg_temp.reserve_managed(j integer) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE r jsonb; BEGIN
 r:=public.reserve_job_credits('00000000-0000-4000-8000-00000000bf01',100,('00000000-0000-4000-8000-00000000bf0'||j)::uuid,'test-render');
 RETURN (r->>'usageLogId')::uuid;
END $$;
CREATE FUNCTION pg_temp.cp(j integer,s integer,a integer,ready boolean) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.checkpoint_job_settlement(('00000000-0000-4000-8000-00000000bf0'||j)::uuid,'00000000-0000-4000-8000-00000000bf01',
 (SELECT usage_log_id FROM public.jobs WHERE id=('00000000-0000-4000-8000-00000000bf0'||j)::uuid),s,a,ready,repeat('a',64),0.25)
$$;
CREATE FUNCTION pg_temp.refuse_managed(statement text,prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN IF position(prefix IN SQLERRM)=1 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'ASSERT FAIL: expected managed refusal %',prefix;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.checkpoint_job_settlement(NULL,NULL,NULL,1,0,false,repeat('a',64));
 RAISE EXCEPTION 'ASSERT FAIL: authenticated checkpoint';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok checkpoint direct execution denied'; END $$;
DO $$ BEGIN
 PERFORM public.settle_checkpointed_job_reservation(NULL);
 RAISE EXCEPTION 'ASSERT FAIL: authenticated managed settlement';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok managed settlement direct execution denied'; END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=pg_temp.reserve_managed(3);
 PERFORM pg_temp.cp(3,1,20,false);
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->>'managed'<>'true' OR r->>'deferred'<>'true' THEN RAISE EXCEPTION 'ASSERT FAIL: active hold not deferred'; END IF;
 PERFORM pg_temp.refuse_managed('SELECT pg_temp.cp(3,1,30,false)','JOB_SETTLEMENT_CONFLICT:');
 PERFORM pg_temp.refuse_managed('SELECT pg_temp.cp(3,2,10,false)','JOB_SETTLEMENT_CONFLICT:');
 PERFORM pg_temp.refuse_managed('SELECT pg_temp.cp(3,2,101,false)','JOB_SETTLEMENT_CONFLICT:');
 PERFORM pg_temp.cp(3,2,40,true);
 UPDATE public.jobs SET status='pending_review' WHERE id='00000000-0000-4000-8000-00000000bf03';
 PERFORM pg_temp.cp(3,2,40,true);
 PERFORM pg_temp.refuse_managed('SELECT pg_temp.cp(3,3,50,true)','JOB_SETTLEMENT_CONFLICT:');
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->>'deferred'<>'true' OR (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bf01')<>900
 THEN RAISE EXCEPTION 'ASSERT FAIL: review changed the hold'; END IF;
 UPDATE public.jobs SET status='completed' WHERE id='00000000-0000-4000-8000-00000000bf03';
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->'settlement'->>'actualCredits'<>'40' OR (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bf01')<>960
 THEN RAISE EXCEPTION 'ASSERT FAIL: approval did not use saved prices'; END IF;
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->'settlement'->>'replayed'<>'true' THEN RAISE EXCEPTION 'ASSERT FAIL: approval replay'; END IF;
 RAISE NOTICE 'ok monotonic checkpoints, review retention and exact delayed approval';
END $$;
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=pg_temp.reserve_managed(4); PERFORM pg_temp.cp(4,1,20,false);
 UPDATE public.jobs SET status='cancelled' WHERE id='00000000-0000-4000-8000-00000000bf04';
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->'settlement'->>'actualCredits'<>'20' THEN RAISE EXCEPTION 'ASSERT FAIL: cancellation lost completed work'; END IF;
 PERFORM pg_temp.refuse_managed('SELECT pg_temp.cp(4,2,30,false)','JOB_SETTLEMENT_CONFLICT:');
 u:=pg_temp.reserve_managed(5);
 UPDATE public.jobs SET status='cancelled' WHERE id='00000000-0000-4000-8000-00000000bf05';
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->'settlement'->>'actualCredits'<>'0' OR (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bf01')<>940
 THEN RAISE EXCEPTION 'ASSERT FAIL: pre-work cancellation charged'; END IF;
 RAISE NOTICE 'ok cancellation charges only a durable completed checkpoint';
END $$;
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=pg_temp.reserve_managed(6);
 UPDATE public.jobs SET status='completed' WHERE id='00000000-0000-4000-8000-00000000bf06';
 PERFORM pg_temp.refuse_managed(format('SELECT public.settle_checkpointed_job_reservation(%L)',u),'JOB_SETTLEMENT_NOT_READY:');
 IF (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved' THEN RAISE EXCEPTION 'ASSERT FAIL: missing decision silently charged'; END IF;
 u:=pg_temp.reserve_managed(7); PERFORM pg_temp.cp(7,2,40,true);
 UPDATE public.jobs SET status='pending_review' WHERE id='00000000-0000-4000-8000-00000000bf07';
 UPDATE public.jobs SET status='cancelled',billing_force_refund=true WHERE id='00000000-0000-4000-8000-00000000bf07';
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->'settlement'->>'actualCredits'<>'0' THEN RAISE EXCEPTION 'ASSERT FAIL: policy withdrawal charged'; END IF;
 u:=pg_temp.reserve_managed(8); PERFORM pg_temp.cp(8,1,50,false);
 UPDATE public.jobs SET status='failed' WHERE id='00000000-0000-4000-8000-00000000bf08';
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->'settlement'->>'actualCredits'<>'0' OR (SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000bf01')<>840
 THEN RAISE EXCEPTION 'ASSERT FAIL: failed result charged'; END IF;
 RAISE NOTICE 'ok missing final decision refuses, review withdrawal and failure refund fully';
END $$;
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=public.reserve_credits('00000000-0000-4000-8000-00000000bf01',100,'00000000-0000-4000-8000-00000000bf09','legacy-render');
 r:=public.settle_checkpointed_job_reservation(u);
 IF r->>'managed'<>'false' OR (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved'
 THEN RAISE EXCEPTION 'ASSERT FAIL: legacy reservation was taken over'; END IF;
 RAISE NOTICE 'ok unmanaged rows retain their existing lifecycle';
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
