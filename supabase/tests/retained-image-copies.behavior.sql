\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT FAIL: %', label; END IF;
  RAISE NOTICE 'ok  %', label;
END $$;
CREATE FUNCTION pg_temp.copy_uuid(kind text, n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (kind || '0000000-0000-4000-8000-' || lpad((950 + n)::text, 12, '0'))::uuid
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data,aud,role) VALUES
 (pg_temp.copy_uuid('0',1),'copy-proof@test.invalid','{}','authenticated','authenticated');
INSERT INTO public.projects(id,user_id,name) VALUES
 (pg_temp.copy_uuid('c',1),pg_temp.copy_uuid('0',1),'Copy proofs');
INSERT INTO public.workflows(id,project_id,user_id,name)
 SELECT pg_temp.copy_uuid('d',n),pg_temp.copy_uuid('c',1),pg_temp.copy_uuid('0',1),'Copy proof ' || n FROM generate_series(1,3) n;
SET LOCAL ROLE service_role;
INSERT INTO public.retained_images(id,user_id,workflow_id,sha256,byte_length,width,height,content_type,charged)
 SELECT pg_temp.copy_uuid('a',n),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',least(n,3)),
   CASE WHEN n = 4 THEN repeat('b',64) ELSE repeat('a',64) END,10,1,1,'image/png',false FROM generate_series(1,4) n;
SELECT public.complete_retained_image(pg_temp.copy_uuid('a',n),CASE WHEN n = 4 THEN repeat('b',64) ELSE repeat('a',64) END)
 FROM generate_series(1,4) n;
INSERT INTO public.jobs(id,user_id,workflow_id,job_type,status,credits,output_data,submission_context) VALUES
 (pg_temp.copy_uuid('f',1),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',1),'generate-image','completed',0,
 '{"imageUrl":"https://media.test/original.png"}','{"kind":"original","input":"immutable"}');
SELECT public.record_retained_job_image(pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),
 pg_temp.copy_uuid('a',1),'https://media.test/original.png');
DELETE FROM public.jobs WHERE id = pg_temp.copy_uuid('f',1);

SELECT pg_temp.assert_true('unattested job cannot become a copy proof', public.record_retained_image_copy(
 pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',2),
 pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',2),NULL,'{"frame":"B"}') IS NULL);
SELECT pg_temp.assert_true('wrong source workflow cannot use the original proof', public.record_retained_image_copy(
 pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',2),
 pg_temp.copy_uuid('d',3),pg_temp.copy_uuid('f',1),NULL,'{"frame":"B"}') IS NULL);
SELECT pg_temp.assert_true('destination image must belong to the destination workflow', public.record_retained_image_copy(
 pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',1),
 pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),NULL,'{"frame":"B"}') IS NULL);
SELECT pg_temp.assert_true('changed bytes cannot claim source provenance', public.record_retained_image_copy(
 pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',3),pg_temp.copy_uuid('a',4),
 pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),NULL,'{"frame":"B"}') IS NULL);
SELECT pg_temp.assert_true('destination capture belongs to the copier', public.record_retained_image_copy(
 pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',2),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',2),
 pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),NULL,'{"frame":"B"}') IS NULL);

SELECT pg_temp.assert_true('copy records its own identity and server-copied original provenance',
 public.record_retained_image_copy(pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',2),
 pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),NULL,'{"frame":"B"}') @>
 jsonb_build_object('id',pg_temp.copy_uuid('b',1),'origin_job_id',pg_temp.copy_uuid('f',1),
 'origin_submission_context','{"kind":"original","input":"immutable"}'::jsonb,'context','{"frame":"B"}'::jsonb));
SELECT pg_temp.assert_true('one original can support multiple copied frames without fake jobs',
 public.record_retained_image_copy(pg_temp.copy_uuid('b',3),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',2),
 pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),NULL,'{"frame":"other B"}') IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = pg_temp.copy_uuid('f',1)));
SELECT pg_temp.assert_true('copy of copy preserves the original job and immediate mapped source',
 public.record_retained_image_copy(pg_temp.copy_uuid('b',2),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',3),pg_temp.copy_uuid('a',3),
 pg_temp.copy_uuid('d',2),NULL,pg_temp.copy_uuid('b',1),'{"frame":"C"}') @>
 jsonb_build_object('origin_job_id',pg_temp.copy_uuid('f',1),'origin_workflow_id',pg_temp.copy_uuid('d',1),
 'source_context','{"frame":"B"}'::jsonb,'origin_submission_context','{"kind":"original","input":"immutable"}'::jsonb));
DO $$ BEGIN
  BEGIN
    UPDATE public.retained_image_copies SET context = '{}' WHERE id = pg_temp.copy_uuid('b',1);
    RAISE EXCEPTION 'ASSERT FAIL: mutable copy proof';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Retained job image is immutable' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.retained_image_copies WHERE id = pg_temp.copy_uuid('b',1);
    RAISE EXCEPTION 'ASSERT FAIL: deletable live copy proof';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Retained job image belongs to an existing workflow' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.record_retained_image_copy(pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',2),
      pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),NULL,'{"frame":"changed"}');
    RAISE EXCEPTION 'ASSERT FAIL: reused identity accepted changed context';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.record_retained_image_copy(pg_temp.copy_uuid('b',1),pg_temp.copy_uuid('0',2),pg_temp.copy_uuid('d',2),pg_temp.copy_uuid('a',2),
      pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('f',1),NULL,'{"frame":"B"}');
    RAISE EXCEPTION 'ASSERT FAIL: reused identity accepted a different copier';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
DELETE FROM public.workflows WHERE id IN (pg_temp.copy_uuid('d',1),pg_temp.copy_uuid('d',2));
SELECT pg_temp.assert_true('copy proof survives original and immediate source deletion', EXISTS (
 SELECT 1 FROM public.retained_image_copies WHERE id = pg_temp.copy_uuid('b',2)
 AND origin_submission_context = '{"kind":"original","input":"immutable"}' AND source_context = '{"frame":"B"}'));
SELECT pg_temp.assert_true('exact retry survives deletion of source workflow', public.record_retained_image_copy(
 pg_temp.copy_uuid('b',2),pg_temp.copy_uuid('0',1),pg_temp.copy_uuid('d',3),pg_temp.copy_uuid('a',3),
 pg_temp.copy_uuid('d',2),NULL,pg_temp.copy_uuid('b',1),'{"frame":"C"}') IS NOT NULL);

RESET ROLE;
SELECT pg_temp.assert_true('anonymous access is revoked', NOT has_table_privilege('anon','public.retained_image_copies','SELECT'));
SELECT pg_temp.assert_true('anonymous proof writer is revoked', NOT has_function_privilege('anon',
 'public.record_retained_image_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)','EXECUTE'));
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.retained_image_copies;
    RAISE EXCEPTION 'ASSERT FAIL: client can read copy proofs';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.record_retained_image_copy(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
      gen_random_uuid(),gen_random_uuid(),NULL,'{}');
    RAISE EXCEPTION 'ASSERT FAIL: client can forge copy proofs';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DELETE FROM public.workflows WHERE id = pg_temp.copy_uuid('d',3);
SELECT pg_temp.assert_true('destination deletion cleans up proof and queues its bytes',
 NOT EXISTS (SELECT 1 FROM public.retained_image_copies WHERE id = pg_temp.copy_uuid('b',2))
 AND EXISTS (SELECT 1 FROM public.retained_image_gc WHERE id = pg_temp.copy_uuid('a',3)));
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
