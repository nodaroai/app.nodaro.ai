-- complete_job_and_settle (migration 513): a job's completion and its ready
-- managed charge commit together; nothing else about either path changes.
BEGIN;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-4000-8000-00000000c501','complete-and-settle@example.test');
UPDATE public.profiles SET subscription_credits=1000,topup_credits=0,daily_spent_credits=0,lifetime_topup_credits=1
 WHERE id='00000000-0000-4000-8000-00000000c501';
INSERT INTO public.jobs(id,user_id,status)
 SELECT ('00000000-0000-4000-8000-00000000c5'||lpad(i::text,2,'0'))::uuid,'00000000-0000-4000-8000-00000000c501','processing'
 FROM generate_series(10,19) i;
CREATE FUNCTION pg_temp.job(j integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('00000000-0000-4000-8000-00000000c5'||lpad(j::text,2,'0'))::uuid
$$;
CREATE FUNCTION pg_temp.reserve_managed(j integer) RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE r jsonb; BEGIN
 r:=public.reserve_job_credits('00000000-0000-4000-8000-00000000c501',100,pg_temp.job(j),'test-render');
 RETURN (r->>'usageLogId')::uuid;
END $$;
CREATE FUNCTION pg_temp.cp(j integer,a integer,ready boolean) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.checkpoint_job_settlement(pg_temp.job(j),'00000000-0000-4000-8000-00000000c501',
 (SELECT usage_log_id FROM public.jobs WHERE id=pg_temp.job(j)),1,a,ready,repeat('b',64),0.25)
$$;
CREATE FUNCTION pg_temp.completion(url text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('status','completed','progress',100,'completed_at','2026-10-13T20:00:00.000Z',
   'output_data',jsonb_build_object('videoUrl',url))
$$;
CREATE FUNCTION pg_temp.balance() RETURNS integer LANGUAGE sql AS $$
 SELECT subscription_credits FROM public.profiles WHERE id='00000000-0000-4000-8000-00000000c501'
$$;
CREATE FUNCTION pg_temp.refused(statement text,prefix text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN IF position(prefix IN SQLERRM)=1 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'ASSERT FAIL: expected refusal %',prefix;
END $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM public.complete_job_and_settle(NULL,NULL);
 RAISE EXCEPTION 'ASSERT FAIL: anon completion';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok anon direct execution denied'; END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.complete_job_and_settle(NULL,NULL);
 RAISE EXCEPTION 'ASSERT FAIL: authenticated completion';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok authenticated direct execution denied'; END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
-- A ready managed checkpoint: ONE call leaves the job completed AND charged.
DO $$ DECLARE u uuid; r jsonb; j public.jobs%ROWTYPE; l public.usage_logs%ROWTYPE; BEGIN
 u:=pg_temp.reserve_managed(10); PERFORM pg_temp.cp(10,40,true);
 IF pg_temp.balance()<>900 THEN RAISE EXCEPTION 'ASSERT FAIL: hold not taken'; END IF;
 r:=public.complete_job_and_settle(pg_temp.job(10),pg_temp.completion('https://r2.example/a.mp4'));
 IF r->>'completed'<>'true' OR r->>'settled'<>'true' OR (r->>'usageLogId')::uuid<>u OR r->>'settleError' IS NOT NULL
 THEN RAISE EXCEPTION 'ASSERT FAIL: ready reply %',r; END IF;
 SELECT * INTO j FROM public.jobs WHERE id=pg_temp.job(10);
 SELECT * INTO l FROM public.usage_logs WHERE id=u;
 IF j.status<>'completed' OR j.progress<>100 OR j.completed_at<>'2026-10-13T20:00:00Z'::timestamptz
   OR j.output_data->>'videoUrl'<>'https://r2.example/a.mp4'
 THEN RAISE EXCEPTION 'ASSERT FAIL: completion columns not written'; END IF;
 IF l.status<>'committed' OR l.credits_charged<>40 OR pg_temp.balance()<>960
 THEN RAISE EXCEPTION 'ASSERT FAIL: ready charge not settled with the completion'; END IF;
 -- A second completion of the same job is the lost race, and settles nothing again.
 r:=public.complete_job_and_settle(pg_temp.job(10),pg_temp.completion('https://r2.example/b.mp4'));
 IF r->>'completed'<>'false' OR (SELECT output_data->>'videoUrl' FROM public.jobs WHERE id=pg_temp.job(10))<>'https://r2.example/a.mp4'
   OR pg_temp.balance()<>960
 THEN RAISE EXCEPTION 'ASSERT FAIL: completion is not single-shot'; END IF;
 RAISE NOTICE 'ok a ready managed charge settles inside the completion, once';
END $$;

-- No ready checkpoint: completed, the hold stays open for the lane.
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=pg_temp.reserve_managed(11); PERFORM pg_temp.cp(11,20,false);
 r:=public.complete_job_and_settle(pg_temp.job(11),pg_temp.completion('x'));
 IF r->>'completed'<>'true' OR r->>'settled'<>'false' OR r->>'settleError' IS NOT NULL
   OR (SELECT status FROM public.jobs WHERE id=pg_temp.job(11))<>'completed'
   OR (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved' OR pg_temp.balance()<>860
 THEN RAISE EXCEPTION 'ASSERT FAIL: unready checkpoint settled %',r; END IF;
 u:=pg_temp.reserve_managed(12);
 r:=public.complete_job_and_settle(pg_temp.job(12),pg_temp.completion('x'));
 IF r->>'settled'<>'false' OR (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved'
 THEN RAISE EXCEPTION 'ASSERT FAIL: checkpoint-less managed hold settled'; END IF;
 RAISE NOTICE 'ok a managed hold without a ready charge is left to its lane';
END $$;

-- A legacy reservation and a job with no reservation: completed, untouched.
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=public.reserve_credits('00000000-0000-4000-8000-00000000c501',100,pg_temp.job(13),'legacy-render');
 UPDATE public.jobs SET usage_log_id=u WHERE id=pg_temp.job(13);
 r:=public.complete_job_and_settle(pg_temp.job(13),pg_temp.completion('x'));
 IF r->>'completed'<>'true' OR r->>'settled'<>'false' OR (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved'
 THEN RAISE EXCEPTION 'ASSERT FAIL: legacy reservation was taken over'; END IF;
 r:=public.complete_job_and_settle(pg_temp.job(14),pg_temp.completion('x'));
 IF r->>'completed'<>'true' OR r->'usageLogId'<>'null'::jsonb
 THEN RAISE EXCEPTION 'ASSERT FAIL: unreserved job %',r; END IF;
 RAISE NOTICE 'ok legacy and unreserved jobs complete with no settlement';
END $$;

-- Terminal and held rows are never completed, and their holds never settled here.
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=pg_temp.reserve_managed(15); PERFORM pg_temp.cp(15,40,true);
 UPDATE public.jobs SET status='cancelled' WHERE id=pg_temp.job(15);
 r:=public.complete_job_and_settle(pg_temp.job(15),pg_temp.completion('x'));
 IF r->>'completed'<>'false' OR (SELECT status FROM public.jobs WHERE id=pg_temp.job(15))<>'cancelled'
   OR (SELECT output_data FROM public.jobs WHERE id=pg_temp.job(15)) IS NOT NULL
   OR (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved'
 THEN RAISE EXCEPTION 'ASSERT FAIL: cancelled row completed or settled'; END IF;
 u:=pg_temp.reserve_managed(16); PERFORM pg_temp.cp(16,40,true);
 UPDATE public.jobs SET status='pending_review' WHERE id=pg_temp.job(16);
 r:=public.complete_job_and_settle(pg_temp.job(16),pg_temp.completion('x'));
 IF r->>'completed'<>'false' OR (SELECT status FROM public.jobs WHERE id=pg_temp.job(16))<>'pending_review'
   OR (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved'
 THEN RAISE EXCEPTION 'ASSERT FAIL: held row completed or settled'; END IF;
 RAISE NOTICE 'ok cancelled and held rows are neither completed nor settled';
END $$;

-- Malformed completions are refused whole: nothing is written.
DO $$ BEGIN
 PERFORM pg_temp.refused(format('SELECT public.complete_job_and_settle(%L,%L)',pg_temp.job(17),
   pg_temp.completion('x') || '{"not_a_column":1}'),'JOB_COMPLETION_INVALID:');
 PERFORM pg_temp.refused(format('SELECT public.complete_job_and_settle(%L,%L)',pg_temp.job(17),
   pg_temp.completion('x') || jsonb_build_object('id',gen_random_uuid())),'JOB_COMPLETION_INVALID:');
 PERFORM pg_temp.refused(format('SELECT public.complete_job_and_settle(%L,%L)',pg_temp.job(17),
   pg_temp.completion('x') || '{"status":"failed"}'),'JOB_COMPLETION_INVALID:');
 PERFORM pg_temp.refused(format('SELECT public.complete_job_and_settle(%L,%L)',pg_temp.job(17),'[]'),'JOB_COMPLETION_INVALID:');
 IF (SELECT status FROM public.jobs WHERE id=pg_temp.job(17))<>'processing'
   OR (SELECT output_data FROM public.jobs WHERE id=pg_temp.job(17)) IS NOT NULL
 THEN RAISE EXCEPTION 'ASSERT FAIL: a refused completion wrote'; END IF;
 RAISE NOTICE 'ok unknown columns, the id and a non-completed status are refused before any write';
END $$;
RESET ROLE;

-- A settlement error never undoes the completion. The settle function is
-- swapped for one that fails (rolled back with the rest of this file).
CREATE OR REPLACE FUNCTION public.settle_checkpointed_job_reservation(p_usage_log_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'JOB_SETTLEMENT_CONFLICT: injected' USING ERRCODE='55021'; END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE u uuid; r jsonb; BEGIN
 u:=pg_temp.reserve_managed(18); PERFORM pg_temp.cp(18,40,true);
 r:=public.complete_job_and_settle(pg_temp.job(18),pg_temp.completion('kept'));
 IF r->>'completed'<>'true' OR r->>'settled'<>'false' OR position('JOB_SETTLEMENT_CONFLICT' IN r->>'settleError')<>1
 THEN RAISE EXCEPTION 'ASSERT FAIL: settle error reply %',r; END IF;
 IF (SELECT status FROM public.jobs WHERE id=pg_temp.job(18))<>'completed'
   OR (SELECT output_data->>'videoUrl' FROM public.jobs WHERE id=pg_temp.job(18))<>'kept'
   OR (SELECT status FROM public.usage_logs WHERE id=u)<>'reserved'
 THEN RAISE EXCEPTION 'ASSERT FAIL: settle error undid the completion'; END IF;
 RAISE NOTICE 'ok a settlement error leaves the job completed and the hold open';
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
