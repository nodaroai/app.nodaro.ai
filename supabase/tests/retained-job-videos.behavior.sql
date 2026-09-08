\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %', label; END IF;
  RAISE NOTICE 'ok  %', label;
END $$;
INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES
 ('00000000-0000-4000-8000-000000000988','retained-job@test.invalid','{}','authenticated','authenticated');
INSERT INTO public.projects(id,user_id,name) VALUES
 ('c0000000-0000-4000-8000-000000000988','00000000-0000-4000-8000-000000000988','Retained jobs');
INSERT INTO public.workflows(id,project_id,user_id,name) VALUES
 ('d0000000-0000-4000-8000-000000000988','c0000000-0000-4000-8000-000000000988','00000000-0000-4000-8000-000000000988','Retained jobs');
SET LOCAL ROLE service_role;
INSERT INTO public.retained_videos(id,user_id,workflow_id,sha256,byte_length,width,height,duration_ms,content_type,charged)
VALUES ('a0000000-0000-4000-8000-000000000988','00000000-0000-4000-8000-000000000988',
 'd0000000-0000-4000-8000-000000000988',repeat('a',64),10,1,1,1200,'video/mp4',false);
SELECT public.complete_retained_video('a0000000-0000-4000-8000-000000000988',repeat('a',64));
INSERT INTO public.jobs(id,user_id,workflow_id,job_type,status,credits,output_data,submission_context) VALUES
 ('f0000000-0000-4000-8000-000000000988','00000000-0000-4000-8000-000000000988',
 'd0000000-0000-4000-8000-000000000988','image-to-video','pending_review',0,
 '{"videoUrl":"https://media.test/result.png"}','{"kind":"test","input":"immutable"}');
SELECT pg_temp.assert_true('held job cannot be captured', public.record_retained_job_video(
 '00000000-0000-4000-8000-000000000988','d0000000-0000-4000-8000-000000000988',
 'f0000000-0000-4000-8000-000000000988','a0000000-0000-4000-8000-000000000988','https://media.test/result.png') IS NULL);
UPDATE public.jobs SET status = 'completed' WHERE id = 'f0000000-0000-4000-8000-000000000988';
SELECT pg_temp.assert_true('changed output cannot be attested', public.record_retained_job_video(
 '00000000-0000-4000-8000-000000000988','d0000000-0000-4000-8000-000000000988',
 'f0000000-0000-4000-8000-000000000988','a0000000-0000-4000-8000-000000000988','https://media.test/other.png') IS NULL);
SELECT pg_temp.assert_true('foreign owner cannot capture job', public.record_retained_job_video(
 '00000000-0000-4000-8000-000000000989','d0000000-0000-4000-8000-000000000988',
 'f0000000-0000-4000-8000-000000000988','a0000000-0000-4000-8000-000000000988','https://media.test/result.png') IS NULL);
SELECT pg_temp.assert_true('completed video copies server context', public.record_retained_job_video(
 '00000000-0000-4000-8000-000000000988','d0000000-0000-4000-8000-000000000988',
 'f0000000-0000-4000-8000-000000000988','a0000000-0000-4000-8000-000000000988','https://media.test/result.png')
 ->'submission_context' = '{"kind":"test","input":"immutable"}'::jsonb);
DO $$ BEGIN
  BEGIN
    UPDATE public.retained_job_videos SET submission_context = '{}' WHERE job_id = 'f0000000-0000-4000-8000-000000000988';
    RAISE EXCEPTION 'ASSERT FAIL: changed provenance';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Retained job video is immutable' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.retained_job_videos WHERE job_id = 'f0000000-0000-4000-8000-000000000988';
    RAISE EXCEPTION 'ASSERT FAIL: deleted live provenance';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Retained job video belongs to an existing workflow' THEN RAISE; END IF; END;
END $$;
DELETE FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-000000000988';
SELECT pg_temp.assert_true('source job deletion preserves attestation', EXISTS (
 SELECT 1 FROM public.retained_job_videos WHERE job_id = 'f0000000-0000-4000-8000-000000000988'));
SELECT pg_temp.assert_true('retry reads original even after job deletion', public.record_retained_job_video(
 '00000000-0000-4000-8000-000000000988','d0000000-0000-4000-8000-000000000988',
 'f0000000-0000-4000-8000-000000000988','a0000000-0000-4000-8000-000000000989','https://media.test/other.png')
 ->>'video_id' = 'a0000000-0000-4000-8000-000000000988');
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.retained_job_videos;
    RAISE EXCEPTION 'ASSERT FAIL: client can read private provenance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.record_retained_job_video(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'https://media.test/video');
    RAISE EXCEPTION 'ASSERT FAIL: client can forge retained provenance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DELETE FROM public.workflows WHERE id = 'd0000000-0000-4000-8000-000000000988';
SELECT pg_temp.assert_true('workflow deletion removes provenance and queues bytes',
 NOT EXISTS (SELECT 1 FROM public.retained_job_videos WHERE job_id = 'f0000000-0000-4000-8000-000000000988')
 AND EXISTS (SELECT 1 FROM public.retained_video_gc WHERE id = 'a0000000-0000-4000-8000-000000000988'));
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
