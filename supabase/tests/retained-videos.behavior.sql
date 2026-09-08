\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %', label; END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role)
VALUES ('00000000-0000-4000-8000-000000000985','retained@test.invalid','{}','authenticated','authenticated');
INSERT INTO public.projects(id,user_id,name) VALUES
 ('c0000000-0000-4000-8000-000000000985','00000000-0000-4000-8000-000000000985','Retained videos');
INSERT INTO public.workflows(id,project_id,user_id,name) VALUES
 ('d0000000-0000-4000-8000-000000000985','c0000000-0000-4000-8000-000000000985','00000000-0000-4000-8000-000000000985','Retained test');
UPDATE public.profiles SET storage_used_bytes = 0, storage_limit_bytes = 1000
 WHERE id = '00000000-0000-4000-8000-000000000985';

SET LOCAL ROLE service_role;
SELECT public.reserve_retained_video('00000000-0000-4000-8000-000000000985',
 'd0000000-0000-4000-8000-000000000985',repeat('a',64),800,10,10,1200,'video/mp4','enforce');
SELECT public.reserve_retained_video('00000000-0000-4000-8000-000000000985',
 'd0000000-0000-4000-8000-000000000985',repeat('a',64),800,10,10,1200,'video/mp4','enforce');
SELECT pg_temp.assert_true('same bytes reserve quota once',
 (SELECT storage_used_bytes = 800 FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000985'));
SELECT pg_temp.assert_true('only one snapshot exists', (SELECT count(*) = 1 FROM public.retained_videos
 WHERE workflow_id = 'd0000000-0000-4000-8000-000000000985'));
DO $$ BEGIN
  BEGIN
    PERFORM public.reserve_retained_video('00000000-0000-4000-8000-000000000985',
      'd0000000-0000-4000-8000-000000000985',repeat('b',64),300,10,10,1200,'video/mp4','enforce');
    RAISE EXCEPTION 'ASSERT FAIL: exceeded storage quota';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Storage limit exceeded' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_true('completion publishes the snapshot', public.complete_retained_video(
 (SELECT id FROM public.retained_videos WHERE workflow_id = 'd0000000-0000-4000-8000-000000000985'),repeat('a',64)));
DO $$ BEGIN
  BEGIN
    UPDATE public.retained_videos SET sha256 = repeat('b',64) WHERE workflow_id = 'd0000000-0000-4000-8000-000000000985';
    RAISE EXCEPTION 'ASSERT FAIL: mutated a snapshot';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Retained video metadata is immutable' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.retained_videos WHERE workflow_id = 'd0000000-0000-4000-8000-000000000985';
    RAISE EXCEPTION 'ASSERT FAIL: deleted retained bytes metadata';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'A retained video cannot be deleted while its production exists' THEN RAISE; END IF; END;
END $$;

INSERT INTO public.jobs(id,user_id,workflow_id,job_type,status,credits) VALUES
 ('f0000000-0000-4000-8000-000000000985','00000000-0000-4000-8000-000000000985',
 'd0000000-0000-4000-8000-000000000985','image-to-video','processing',0);
DO $$ BEGIN
  BEGIN
    DELETE FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000000985';
    RAISE EXCEPTION 'ASSERT FAIL: deleted production during active video use';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'This production has active jobs using retained videos' THEN RAISE; END IF; END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000985';
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.retained_videos;
    RAISE EXCEPTION 'ASSERT FAIL: client read private snapshot records';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.reserve_retained_video('00000000-0000-4000-8000-000000000985',
      'd0000000-0000-4000-8000-000000000985',repeat('c',64),10,10,10,1200,'video/mp4','none');
    RAISE EXCEPTION 'ASSERT FAIL: client bypassed quota through reservation RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
UPDATE public.jobs SET status = 'completed' WHERE id = 'f0000000-0000-4000-8000-000000000985';
DELETE FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000000985';
SELECT pg_temp.assert_true('workflow cascade removes snapshots', NOT EXISTS (SELECT 1 FROM public.retained_videos
 WHERE workflow_id = 'd0000000-0000-4000-8000-000000000985'));
SELECT pg_temp.assert_true('cascade durably queues physical cleanup', (SELECT count(*) = 1 FROM public.retained_video_gc
 WHERE user_id = '00000000-0000-4000-8000-000000000985'));
SELECT pg_temp.assert_true('quota stays charged before physical cleanup',
 (SELECT storage_used_bytes = 800 FROM public.profiles WHERE id = '00000000-0000-4000-8000-000000000985'));
SELECT pg_temp.assert_true('upload grace period prevents early cleanup', NOT EXISTS (SELECT * FROM public.claim_retained_video_gc(50)
 WHERE user_id = '00000000-0000-4000-8000-000000000985'));
-- Advance only the GC fixture's eligibility; production snapshot deadlines are immutable.
UPDATE public.retained_video_gc SET not_before = now() - interval '1 minute'
 WHERE user_id = '00000000-0000-4000-8000-000000000985';
SELECT pg_temp.assert_true('eligible object is claimed', EXISTS (SELECT * FROM public.claim_retained_video_gc(50)
 WHERE user_id = '00000000-0000-4000-8000-000000000985'));
SELECT pg_temp.assert_true('successful cleanup refunds quota', public.complete_retained_video_gc(
 (SELECT id FROM public.retained_video_gc WHERE user_id = '00000000-0000-4000-8000-000000000985')));
SELECT pg_temp.assert_true('duplicate completion cannot refund twice', NOT public.complete_retained_video_gc(
 (SELECT id FROM public.retained_video_gc WHERE user_id = '00000000-0000-4000-8000-000000000985')));
SELECT pg_temp.assert_true('quota was refunded once', (SELECT storage_used_bytes = 0 FROM public.profiles
 WHERE id = '00000000-0000-4000-8000-000000000985'));
INSERT INTO public.workflows(id,project_id,user_id,name) VALUES
 ('d0000000-0000-4000-8000-000000000986','c0000000-0000-4000-8000-000000000985','00000000-0000-4000-8000-000000000985','Expired capture');
INSERT INTO public.retained_videos(id,user_id,workflow_id,sha256,byte_length,width,height,duration_ms,content_type,charged,upload_until)
VALUES ('a0000000-0000-4000-8000-000000000986','00000000-0000-4000-8000-000000000985',
 'd0000000-0000-4000-8000-000000000986',repeat('d',64),10,10,10,1200,'video/mp4',false,now()-interval '10 minutes');
SELECT pg_temp.assert_true('expired upload cannot publish', NOT public.complete_retained_video(
 'a0000000-0000-4000-8000-000000000986',repeat('d',64)));
SELECT * FROM public.claim_retained_video_gc(50);
SELECT pg_temp.assert_true('expired capture loses its readable record', NOT EXISTS (
 SELECT 1 FROM public.retained_videos WHERE id = 'a0000000-0000-4000-8000-000000000986'));
SELECT pg_temp.assert_true('expired capture has durable cleanup', EXISTS (
 SELECT 1 FROM public.retained_video_gc WHERE id = 'a0000000-0000-4000-8000-000000000986'));
DO $$ BEGIN
  BEGIN
    INSERT INTO public.retained_videos(id,user_id,workflow_id,sha256,byte_length,width,height,duration_ms,content_type,charged)
    VALUES ('a0000000-0000-4000-8000-000000000986','00000000-0000-4000-8000-000000000985',
      'd0000000-0000-4000-8000-000000000986',repeat('d',64),10,10,10,1200,'video/mp4',false);
    RAISE EXCEPTION 'ASSERT FAIL: reused a tombstoned object id';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'A deleted snapshot id cannot be reused' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- The contributor is different from the owner of this surviving workflow.
INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role)
VALUES ('00000000-0000-4000-8000-000000000987','retained-contributor@test.invalid','{}','authenticated','authenticated');
SET LOCAL ROLE service_role;
SELECT public.reserve_retained_video('00000000-0000-4000-8000-000000000987',
 'd0000000-0000-4000-8000-000000000986',repeat('e',64),10,10,10,1200,'video/mp4','none');
SELECT public.complete_retained_video((SELECT id FROM public.retained_videos
 WHERE user_id = '00000000-0000-4000-8000-000000000987'),repeat('e',64));
RESET ROLE;
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000987';
SELECT pg_temp.assert_true('contributor deletion preserves shared production bytes', EXISTS (
 SELECT 1 FROM public.retained_videos WHERE user_id = '00000000-0000-4000-8000-000000000987' AND state = 'ready'));
SET LOCAL ROLE service_role;
DELETE FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000000986';
SELECT pg_temp.assert_true('departed contributor snapshot still queues workflow cleanup', EXISTS (
 SELECT 1 FROM public.retained_video_gc WHERE user_id = '00000000-0000-4000-8000-000000000987'));
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
