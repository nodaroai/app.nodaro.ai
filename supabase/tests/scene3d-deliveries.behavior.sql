-- The same proofs run against Supabase Postgres in CI. No fixture survives.
BEGIN;
INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-4000-8000-00000000de01', 'delivery-owner@example.test'),
 ('00000000-0000-4000-8000-00000000de02', 'delivery-viewer@example.test');
INSERT INTO public.projects(id, user_id, name) VALUES
 ('00000000-0000-4000-8000-00000000de03', '00000000-0000-4000-8000-00000000de01', 'Delivery proof');
INSERT INTO public.workflows(id, user_id, project_id, name) VALUES
 ('00000000-0000-4000-8000-00000000de04', '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000de03', 'Source access anchor');
INSERT INTO public.jobs(id, user_id, status) VALUES
 ('00000000-0000-4000-8000-00000000de05', '00000000-0000-4000-8000-00000000de02', 'processing'),
 ('00000000-0000-4000-8000-00000000de06', '00000000-0000-4000-8000-00000000de02', 'cancelled'),
 ('00000000-0000-4000-8000-00000000de07', '00000000-0000-4000-8000-00000000de02', 'processing');
INSERT INTO public.scene3d_revisions(id, user_id, workflow_id, plan, plan_sha256) VALUES
 ('00000000-0000-4000-8000-00000000de08', '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000de04',
  '{"planType":"3d-scene","schemaVersion":2,"revisionId":"00000000-0000-4000-8000-00000000de08"}', repeat('a',64));
INSERT INTO public.scene3d_artifacts(id, user_id, kind, bucket, object_key, sha256, byte_length, etag, created_at) VALUES
 ('00000000-0000-4000-8000-00000000de09', '00000000-0000-4000-8000-00000000de01',
  'validation-report', 'private-scenes', 'retained-report.json', repeat('b',64), 32, 'report-tag', now() - interval '2 days');
INSERT INTO public.scene3d_revision_artifacts(revision_id, artifact_id, user_id, usage) VALUES
 ('00000000-0000-4000-8000-00000000de08', '00000000-0000-4000-8000-00000000de09',
  '00000000-0000-4000-8000-00000000de01', 'validation');
INSERT INTO public.scene3d_upload_intents(artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
VALUES ('00000000-0000-4000-8000-00000000de10', '00000000-0000-4000-8000-00000000de02',
 '00000000-0000-4000-8000-00000000de05', '00000000-0000-4000-8000-00000000de08', 'poster', 'private-scenes',
 'delivery-poster.png', now() + interval '1 hour', now() + interval '2 hours');

CREATE FUNCTION pg_temp.delivery_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'job_id','00000000-0000-4000-8000-00000000de05','user_id','00000000-0000-4000-8000-00000000de02',
  'source_kind','retained-revision','source_revision_id','00000000-0000-4000-8000-00000000de08',
  'source_owner_id','00000000-0000-4000-8000-00000000de01','source_workflow_id','00000000-0000-4000-8000-00000000de04',
  'source_plan_sha256',repeat('a',64),'mode','render-only',
  'artifacts', jsonb_build_array(
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000de10',
     'artifact_owner_id','00000000-0000-4000-8000-00000000de02','usage','poster','kind','poster',
     'sha256',repeat('c',64),'byte_length',64,'bucket','private-scenes','object_key','delivery-poster.png','etag','poster-tag'),
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000de09',
     'artifact_owner_id','00000000-0000-4000-8000-00000000de01','usage','validation','kind','validation-report',
     'via_revision_id','00000000-0000-4000-8000-00000000de08',
     'sha256',repeat('b',64),'byte_length',32,'bucket','private-scenes','object_key','retained-report.json','etag','report-tag')))
$$;

SET LOCAL ROLE anon;
DO $$ BEGIN
 PERFORM * FROM public.scene3d_deliveries;
 RAISE EXCEPTION 'ASSERT FAIL: anonymous delivery read succeeded';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok anonymous delivery metadata is inaccessible'; END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM * FROM public.scene3d_delivery_artifacts;
 RAISE EXCEPTION 'ASSERT FAIL: authenticated bypassed delivery API';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok delivery pins require API authorization'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery('{}');
 RAISE EXCEPTION 'ASSERT FAIL: authenticated published a delivery';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok direct delivery publication is revoked'; END $$;
SET LOCAL ROLE service_role;

DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(pg_temp.delivery_payload() || '{"job_id":"00000000-0000-4000-8000-00000000de06"}');
 RAISE EXCEPTION 'ASSERT FAIL: cancelled parent published';
EXCEPTION WHEN SQLSTATE '55016' THEN RAISE NOTICE 'ok cancelled parent cannot publish'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(pg_temp.delivery_payload() || jsonb_build_object('source_plan_sha256', repeat('d',64)));
 RAISE EXCEPTION 'ASSERT FAIL: altered source identity published';
EXCEPTION WHEN SQLSTATE '55010' THEN RAISE NOTICE 'ok exact retained source identity is enforced'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(pg_temp.delivery_payload() || '{"mode":"authored"}');
 RAISE EXCEPTION 'ASSERT FAIL: render-only parent claimed source authorship';
EXCEPTION WHEN SQLSTATE '55010' THEN RAISE NOTICE 'ok authored delivery must come from this parent'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(pg_temp.delivery_payload() || '{"job_id":"00000000-0000-4000-8000-00000000de07"}');
 RAISE EXCEPTION 'ASSERT FAIL: another parent consumed an upload';
EXCEPTION WHEN SQLSTATE '55017' THEN RAISE NOTICE 'ok minted upload is scoped to its exact parent'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.delivery_payload(), '{artifacts,1,via_revision_id}',
   '"00000000-0000-4000-8000-00000000de11"'));
 RAISE EXCEPTION 'ASSERT FAIL: unpinned report reused';
EXCEPTION WHEN SQLSTATE '55013' THEN RAISE NOTICE 'ok reuse needs the exact source pin'; END $$;
DO $$ BEGIN
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_deliveries), 'ASSERT FAIL: failed publication left a delivery';
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_artifacts WHERE id='00000000-0000-4000-8000-00000000de10'),
   'ASSERT FAIL: failed publication left minted metadata';
 ASSERT EXISTS (SELECT FROM public.scene3d_upload_intents WHERE artifact_id='00000000-0000-4000-8000-00000000de10'),
   'ASSERT FAIL: failed publication consumed a reservation';
 ASSERT public.scene3d_publish_delivery(pg_temp.delivery_payload())='created', 'ASSERT FAIL: valid publication failed';
 ASSERT (SELECT count(*) FROM public.scene3d_delivery_artifacts)=2, 'ASSERT FAIL: delivery pins missing';
 ASSERT (SELECT count(*) FROM public.scene3d_revisions)=1, 'ASSERT FAIL: export cloned source';
 ASSERT (SELECT count(*) FROM public.scene3d_revision_artifacts)=1, 'ASSERT FAIL: export changed source pins';
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_upload_intents WHERE artifact_id='00000000-0000-4000-8000-00000000de10'),
   'ASSERT FAIL: publication left upload intent';
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_artifact_gc WHERE artifact_id='00000000-0000-4000-8000-00000000de10'),
   'ASSERT FAIL: publication queued its own poster for deletion';
 RAISE NOTICE 'ok atomic cross-owner delivery preserves source and consumes its own intent';
END $$;
UPDATE public.jobs SET status='completed' WHERE id='00000000-0000-4000-8000-00000000de05';
DO $$ BEGIN
 ASSERT public.scene3d_publish_delivery(pg_temp.delivery_payload())='unchanged', 'ASSERT FAIL: completed delivery replay failed';
 RAISE NOTICE 'ok replay survives parent completion';
END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.delivery_payload(), '{artifacts,0,sha256}', to_jsonb(repeat('f',64))));
 RAISE EXCEPTION 'ASSERT FAIL: replay replaced delivered bytes';
EXCEPTION WHEN SQLSTATE '55010' THEN RAISE NOTICE 'ok replay refuses different bytes'; END $$;
DO $$ BEGIN
 UPDATE public.scene3d_deliveries SET source_workflow_id=NULL;
 RAISE EXCEPTION 'ASSERT FAIL: source authority was removed';
EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'ok source authorization anchor is immutable'; END $$;

DELETE FROM public.scene3d_revisions WHERE id='00000000-0000-4000-8000-00000000de08';
DO $$ BEGIN
 PERFORM public.scene3d_sweep_expired_artifacts(100);
 ASSERT EXISTS (SELECT FROM public.scene3d_artifacts WHERE id='00000000-0000-4000-8000-00000000de09'),
   'ASSERT FAIL: source deletion collected delivered evidence';
 ASSERT (SELECT source_workflow_id FROM public.scene3d_deliveries WHERE job_id='00000000-0000-4000-8000-00000000de05')
   = '00000000-0000-4000-8000-00000000de04'::uuid, 'ASSERT FAIL: source deletion lost authorization anchor';
 RAISE NOTICE 'ok delivery retains evidence and access anchor after source revision deletion';
END $$;
DELETE FROM public.workflows WHERE id='00000000-0000-4000-8000-00000000de04';
DO $$ BEGIN
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_deliveries), 'ASSERT FAIL: source workflow deletion retained access';
 PERFORM public.scene3d_sweep_expired_artifacts(100);
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_artifacts WHERE id='00000000-0000-4000-8000-00000000de09'),
   'ASSERT FAIL: unpinned non-expiring artifact was orphaned';
 ASSERT EXISTS (SELECT FROM public.scene3d_artifact_gc WHERE artifact_id='00000000-0000-4000-8000-00000000de09'),
   'ASSERT FAIL: orphan cleanup was not durable';
 RAISE NOTICE 'ok source workflow deletion revokes delivery and orphan cleanup is durable';
 RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;
ROLLBACK;

-- Basic v1 scenes have job-output retention, without a retained revision row.
BEGIN;
INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-4000-8000-00000000df01', 'basic-delivery@example.test'),
 ('00000000-0000-4000-8000-00000000df02', 'foreign-basic@example.test');
INSERT INTO public.jobs(id, user_id, status, output_data) VALUES
 ('00000000-0000-4000-8000-00000000df03', '00000000-0000-4000-8000-00000000df01', 'completed',
  '{"scenePlan":{"planType":"3d-scene","schemaVersion":1,"revisionId":"00000000-0000-4000-8000-00000000df05"}}'),
 ('00000000-0000-4000-8000-00000000df04', '00000000-0000-4000-8000-00000000df01', 'processing', NULL),
 ('00000000-0000-4000-8000-00000000df08', '00000000-0000-4000-8000-00000000df02', 'completed',
  '{"scenePlan":{"planType":"3d-scene","schemaVersion":1,"revisionId":"00000000-0000-4000-8000-00000000df05"}}');
INSERT INTO public.scene3d_upload_intents(artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
SELECT id, '00000000-0000-4000-8000-00000000df01', '00000000-0000-4000-8000-00000000df04',
 '00000000-0000-4000-8000-00000000df05', kind, 'private-scenes', object_key, now()+interval '1 hour', now()+interval '2 hours'
FROM (VALUES
 ('00000000-0000-4000-8000-00000000df06'::uuid, 'poster', 'basic-poster.png'),
 ('00000000-0000-4000-8000-00000000df07'::uuid, 'validation-report', 'basic-report.json')) AS items(id, kind, object_key);
CREATE FUNCTION pg_temp.basic_delivery_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('job_id','00000000-0000-4000-8000-00000000df04',
  'user_id','00000000-0000-4000-8000-00000000df01', 'source_kind','job-output',
  'source_revision_id','00000000-0000-4000-8000-00000000df05',
  'source_job_id','00000000-0000-4000-8000-00000000df03',
  'source_owner_id','00000000-0000-4000-8000-00000000df01',
  'source_plan_sha256',repeat('a',64),'mode','render-only',
  'source_plan','{"planType":"3d-scene","schemaVersion":1,"revisionId":"00000000-0000-4000-8000-00000000df05"}'::jsonb,
  'artifacts',jsonb_build_array(
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000df06',
    'artifact_owner_id','00000000-0000-4000-8000-00000000df01','usage','poster','kind','poster',
    'sha256',repeat('b',64),'byte_length',32,'bucket','private-scenes','object_key','basic-poster.png','etag','basic-poster'),
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000df07',
    'artifact_owner_id','00000000-0000-4000-8000-00000000df01','usage','validation','kind','validation-report',
    'sha256',repeat('c',64),'byte_length',64,'bucket','private-scenes','object_key','basic-report.json','etag','basic-report')))
$$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(pg_temp.basic_delivery_payload() || '{"source_job_id":"00000000-0000-4000-8000-00000000df08"}');
 RAISE EXCEPTION 'ASSERT FAIL: foreign Basic source job exported';
EXCEPTION WHEN SQLSTATE '55016' THEN RAISE NOTICE 'ok Basic source jobs require ownership'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(pg_temp.basic_delivery_payload() || '{"mode":"authored"}');
 RAISE EXCEPTION 'ASSERT FAIL: Basic export claimed authorship of an existing source';
EXCEPTION WHEN SQLSTATE '55016' THEN RAISE NOTICE 'ok Basic source exports cannot claim authorship'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.basic_delivery_payload(), '{source_plan,title}', '"changed"'));
 RAISE EXCEPTION 'ASSERT FAIL: modified Basic source plan exported';
EXCEPTION WHEN SQLSTATE '55016' THEN RAISE NOTICE 'ok Basic source must match retained job output exactly'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.basic_delivery_payload(), '{artifacts,1,kind}', '"source-json"'));
 RAISE EXCEPTION 'ASSERT FAIL: private source JSON was published as delivery evidence';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok delivery kinds are a strict allowlist'; END $$;
DO $$ BEGIN
 ASSERT public.scene3d_publish_delivery(pg_temp.basic_delivery_payload())='created', 'ASSERT FAIL: Basic export failed';
 ASSERT (SELECT count(*) FROM public.scene3d_delivery_artifacts WHERE job_id='00000000-0000-4000-8000-00000000df04')=2,
   'ASSERT FAIL: Basic export did not retain mandatory poster and report';
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_revisions WHERE id='00000000-0000-4000-8000-00000000df05'),
   'ASSERT FAIL: Basic export invented a retained scene revision';
 RAISE NOTICE 'ok Basic export retains both mandatory artifacts without cloning its scene';
END $$;
DELETE FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000df03';
DO $$ BEGIN
 ASSERT (SELECT source_job_id IS NULL FROM public.scene3d_deliveries WHERE job_id='00000000-0000-4000-8000-00000000df04'),
   'ASSERT FAIL: source history deletion failed';
 ASSERT (SELECT source_revision_id FROM public.scene3d_deliveries WHERE job_id='00000000-0000-4000-8000-00000000df04')
   ='00000000-0000-4000-8000-00000000df05'::uuid, 'ASSERT FAIL: source revision identity was lost';
 RAISE NOTICE 'ok Basic delivery preserves source identity after history deletion';
END $$;
DELETE FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000df04';
DO $$ BEGIN
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_delivery_artifacts WHERE job_id='00000000-0000-4000-8000-00000000df04'),
   'ASSERT FAIL: deleted parent left delivery pins';
 RAISE NOTICE 'ok deleting parent removes delivery and its pins';
 RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;
ROLLBACK;

-- One still per shot, pinned alongside the poster and the report.
BEGIN;
INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-4000-8000-00000000dc01', 'stills-owner@example.test');
INSERT INTO public.projects(id, user_id, name) VALUES
 ('00000000-0000-4000-8000-00000000dc02', '00000000-0000-4000-8000-00000000dc01', 'Stills proof');
INSERT INTO public.workflows(id, user_id, project_id, name) VALUES
 ('00000000-0000-4000-8000-00000000dc03', '00000000-0000-4000-8000-00000000dc01',
  '00000000-0000-4000-8000-00000000dc02', 'Stills anchor');
INSERT INTO public.jobs(id, user_id, workflow_id, status) VALUES
 ('00000000-0000-4000-8000-00000000dc04', '00000000-0000-4000-8000-00000000dc01',
  '00000000-0000-4000-8000-00000000dc03', 'processing');
INSERT INTO public.scene3d_revisions(id, user_id, workflow_id, plan, plan_sha256) VALUES
 ('00000000-0000-4000-8000-00000000dc05', '00000000-0000-4000-8000-00000000dc01',
  '00000000-0000-4000-8000-00000000dc03',
  '{"planType":"3d-scene","schemaVersion":2,"revisionId":"00000000-0000-4000-8000-00000000dc05"}', repeat('a',64));
INSERT INTO public.scene3d_upload_intents(artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
VALUES
 ('00000000-0000-4000-8000-00000000dc06', '00000000-0000-4000-8000-00000000dc01',
  '00000000-0000-4000-8000-00000000dc04', '00000000-0000-4000-8000-00000000dc05', 'poster', 'private-scenes',
  'stills-poster.png', now() + interval '1 hour', now() + interval '2 hours'),
 ('00000000-0000-4000-8000-00000000dc07', '00000000-0000-4000-8000-00000000dc01',
  '00000000-0000-4000-8000-00000000dc04', '00000000-0000-4000-8000-00000000dc05', 'validation-report', 'private-scenes',
  'stills-report.json', now() + interval '1 hour', now() + interval '2 hours'),
 ('00000000-0000-4000-8000-00000000dc08', '00000000-0000-4000-8000-00000000dc01',
  '00000000-0000-4000-8000-00000000dc04', '00000000-0000-4000-8000-00000000dc05', 'shot-still', 'private-scenes',
  'shot-0.png', now() + interval '1 hour', now() + interval '2 hours'),
 ('00000000-0000-4000-8000-00000000dc09', '00000000-0000-4000-8000-00000000dc01',
  '00000000-0000-4000-8000-00000000dc04', '00000000-0000-4000-8000-00000000dc05', 'shot-still', 'private-scenes',
  'shot-1.png', now() + interval '1 hour', now() + interval '2 hours');

CREATE FUNCTION pg_temp.stills_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'job_id','00000000-0000-4000-8000-00000000dc04','user_id','00000000-0000-4000-8000-00000000dc01',
  'source_kind','retained-revision','source_revision_id','00000000-0000-4000-8000-00000000dc05',
  'source_owner_id','00000000-0000-4000-8000-00000000dc01','source_workflow_id','00000000-0000-4000-8000-00000000dc03',
  'source_plan_sha256',repeat('a',64),'mode','render-only',
  'artifacts', jsonb_build_array(
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000dc06',
     'artifact_owner_id','00000000-0000-4000-8000-00000000dc01','usage','poster','kind','poster',
     'sha256',repeat('c',64),'byte_length',64,'bucket','private-scenes','object_key','stills-poster.png','etag','poster-tag'),
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000dc07',
     'artifact_owner_id','00000000-0000-4000-8000-00000000dc01','usage','validation','kind','validation-report',
     'sha256',repeat('b',64),'byte_length',32,'bucket','private-scenes','object_key','stills-report.json','etag','report-tag'),
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000dc08',
     'artifact_owner_id','00000000-0000-4000-8000-00000000dc01','usage','shot-still','kind','shot-still',
     'shot_index',0,'frame',0,'width',1280,'height',720,
     'sha256',repeat('d',64),'byte_length',48,'bucket','private-scenes','object_key','shot-0.png','etag','shot-0-tag'),
   jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000dc09',
     'artifact_owner_id','00000000-0000-4000-8000-00000000dc01','usage','shot-still','kind','shot-still',
     'shot_index',1,'frame',96,'width',1280,'height',720,
     'sha256',repeat('e',64),'byte_length',48,'bucket','private-scenes','object_key','shot-1.png','etag','shot-1-tag')))
$$;

SET LOCAL ROLE service_role;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.stills_payload(), '{artifacts,3,shot_index}', '0'));
 RAISE EXCEPTION 'ASSERT FAIL: two stills claimed one shot';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok a shot owns at most one still'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.stills_payload(), '{artifacts,3,frame}', '0'));
 RAISE EXCEPTION 'ASSERT FAIL: two stills claimed one frame';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok a frame owns at most one still'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(pg_temp.stills_payload() #- '{artifacts,2,frame}');
 RAISE EXCEPTION 'ASSERT FAIL: a still published without its frame';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok a still must name its own frame'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.stills_payload(), '{artifacts,0,shot_index}', '0'));
 RAISE EXCEPTION 'ASSERT FAIL: a poster carried a shot identity';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok only a still carries a shot identity'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.stills_payload(), '{artifacts,2,via_revision_id}',
   '"00000000-0000-4000-8000-00000000dc05"'));
 RAISE EXCEPTION 'ASSERT FAIL: a still was reused from a revision';
EXCEPTION WHEN SQLSTATE '55013' THEN RAISE NOTICE 'ok a revision never pins a still to reuse'; END $$;
DO $$ BEGIN
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_deliveries), 'ASSERT FAIL: a refused publication left a delivery';
 ASSERT public.scene3d_publish_delivery(pg_temp.stills_payload())='created', 'ASSERT FAIL: stills publication failed';
 ASSERT (SELECT count(*) FROM public.scene3d_delivery_artifacts WHERE usage='shot-still')=2,
   'ASSERT FAIL: the delivery did not pin both stills';
 ASSERT (SELECT array_agg(artifact_id ORDER BY shot_index) FROM public.scene3d_delivery_artifacts WHERE usage='shot-still')
   = ARRAY['00000000-0000-4000-8000-00000000dc08','00000000-0000-4000-8000-00000000dc09']::uuid[],
   'ASSERT FAIL: stills are not ordered by shot';
 ASSERT (SELECT frame FROM public.scene3d_delivery_artifacts WHERE artifact_id='00000000-0000-4000-8000-00000000dc09')=96,
   'ASSERT FAIL: a still lost its frame';
 RAISE NOTICE 'ok a delivery pins one still per shot beside its poster and report';
END $$;
DO $$ BEGIN
 ASSERT public.scene3d_publish_delivery(pg_temp.stills_payload())='unchanged', 'ASSERT FAIL: exact replay failed';
 RAISE NOTICE 'ok an exact replay of a stills delivery is unchanged';
END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_delivery(jsonb_set(pg_temp.stills_payload(), '{artifacts,3,frame}', '97'));
 RAISE EXCEPTION 'ASSERT FAIL: replay moved a still to another frame';
EXCEPTION WHEN SQLSTATE '55010' THEN RAISE NOTICE 'ok a replay refuses a different shot identity'; END $$;
DELETE FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000dc04';
DO $$ BEGIN
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_delivery_artifacts WHERE usage='shot-still'),
   'ASSERT FAIL: deleting the parent left still pins';
 RAISE NOTICE 'ok deleting the parent removes its still pins';
 RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;
ROLLBACK;
