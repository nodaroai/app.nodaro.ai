-- ============================================================================
-- Behavioral proof: a Pro run whose recipe NEVER compiled can still retain the
-- compiler's reasons and its last recipe (migration 421).
--
-- WHY THIS PROOF EXISTS. The application tests for this lane mock the RPC
-- entirely, so every rule that actually protects it lives here and is provable
-- nowhere else:
--   1. Nothing but service_role may call it.
--   2. A new delivery needs a RUNNING parent. That is the whole ordering
--      property the retention design rests on — retention publishes while the
--      job is still processing, so a late worker that lost its lease and
--      finished after the verdict settled can publish nothing at all.
--   3. Its evidence rules are its own: exactly one report, at most the recipe
--      beside it, and never a poster — nothing was rendered, so a poster here
--      would be bytes nothing produced.
--   4. A replay adopts; anything else conflicts. Including, in particular, a
--      job that already published a RENDERED delivery: this must never
--      overwrite one.
--   5. The recipe survives the GC sweep because the delivery pins it. That is
--      the only reason retaining it means anything.
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-00000000df01 upward).
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/scene3d-refused-delivery.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-4000-8000-00000000df01', 'refused-owner@example.test');
INSERT INTO public.projects(id, user_id, name) VALUES
 ('00000000-0000-4000-8000-00000000df02', '00000000-0000-4000-8000-00000000df01', 'Refused proof');
INSERT INTO public.workflows(id, user_id, project_id, name) VALUES
 ('00000000-0000-4000-8000-00000000df03', '00000000-0000-4000-8000-00000000df01',
  '00000000-0000-4000-8000-00000000df02', 'Refused authoring anchor');
-- df04 is the run that ends in SCENE_QUALITY_FAILED; df05 already settled.
INSERT INTO public.jobs(id, user_id, workflow_id, status) VALUES
 ('00000000-0000-4000-8000-00000000df04', '00000000-0000-4000-8000-00000000df01',
  '00000000-0000-4000-8000-00000000df03', 'processing'),
 ('00000000-0000-4000-8000-00000000df05', '00000000-0000-4000-8000-00000000df01',
  '00000000-0000-4000-8000-00000000df03', 'failed');
-- The attempt identity the run ended on. Deliberately NOT a published revision:
-- nothing compiled, so `scene3d_revisions` stays empty for the whole proof.
INSERT INTO public.scene3d_upload_intents(artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
VALUES
 ('00000000-0000-4000-8000-00000000df10', '00000000-0000-4000-8000-00000000df01',
  '00000000-0000-4000-8000-00000000df04', '00000000-0000-4000-8000-00000000df09',
  'validation-report', 'private-scenes', 'refusal-report.json', now() + interval '1 hour', now() + interval '2 hours'),
 ('00000000-0000-4000-8000-00000000df11', '00000000-0000-4000-8000-00000000df01',
  '00000000-0000-4000-8000-00000000df04', '00000000-0000-4000-8000-00000000df09',
  'source-json', 'private-scenes', 'refused-recipe.json', now() + interval '1 hour', now() + interval '2 hours'),
 -- Reserved by the OTHER job, to prove an intent is scoped to its own parent.
 ('00000000-0000-4000-8000-00000000df12', '00000000-0000-4000-8000-00000000df01',
  '00000000-0000-4000-8000-00000000df05', '00000000-0000-4000-8000-00000000df09',
  'validation-report', 'private-scenes', 'other-report.json', now() + interval '1 hour', now() + interval '2 hours');

CREATE FUNCTION pg_temp.report_entry() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000df10',
   'artifact_owner_id','00000000-0000-4000-8000-00000000df01','usage','validation','kind','validation-report',
   'sha256',repeat('b',64),'byte_length',96,'bucket','private-scenes','object_key','refusal-report.json','etag','report-tag')
$$;
CREATE FUNCTION pg_temp.recipe_entry() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('artifact_id','00000000-0000-4000-8000-00000000df11',
   'artifact_owner_id','00000000-0000-4000-8000-00000000df01','usage','checkpoint','kind','source-json',
   'sha256',repeat('c',64),'byte_length',512,'bucket','private-scenes','object_key','refused-recipe.json','etag','recipe-tag')
$$;
CREATE FUNCTION pg_temp.refused_payload() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
  'job_id','00000000-0000-4000-8000-00000000df04','user_id','00000000-0000-4000-8000-00000000df01',
  'source_revision_id','00000000-0000-4000-8000-00000000df09',
  'artifacts', jsonb_build_array(pg_temp.report_entry(), pg_temp.recipe_entry()))
$$;

-- 1. Nobody but the platform publishes one.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery('{}');
 RAISE EXCEPTION 'ASSERT FAIL: authenticated published a refused delivery';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok direct refused publication is revoked'; END $$;
SET LOCAL ROLE service_role;

-- 2. Its evidence rules are its own, and each is refused BEFORE anything durable.
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(pg_temp.refused_payload()
   || jsonb_build_object('artifacts', jsonb_build_array(pg_temp.recipe_entry())));
 RAISE EXCEPTION 'ASSERT FAIL: a refused delivery published without its report';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok a refused delivery requires its validation report'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(pg_temp.refused_payload()
   || jsonb_build_object('artifacts', jsonb_build_array(pg_temp.report_entry(),
        jsonb_set(jsonb_set(pg_temp.recipe_entry(), '{kind}', '"poster"'), '{usage}', '"poster"'))));
 RAISE EXCEPTION 'ASSERT FAIL: a refused delivery pinned a poster';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok nothing was rendered, so no poster may be pinned'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(pg_temp.refused_payload()
   || jsonb_build_object('artifacts', jsonb_build_array(pg_temp.report_entry(),
        jsonb_set(pg_temp.report_entry(), '{artifact_id}', '"00000000-0000-4000-8000-00000000df11"'))));
 RAISE EXCEPTION 'ASSERT FAIL: a refused delivery published two reports';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok exactly one report, never two'; END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(pg_temp.refused_payload()
   || jsonb_build_object('artifacts', jsonb_build_array(
        jsonb_set(pg_temp.report_entry(), '{via_revision_id}', '"00000000-0000-4000-8000-00000000df09"'))));
 RAISE EXCEPTION 'ASSERT FAIL: a refused delivery reused a revision pin';
EXCEPTION WHEN SQLSTATE '55015' THEN RAISE NOTICE 'ok there is no revision to reuse anything from'; END $$;

-- 3. An upload minted for a DIFFERENT parent is not this one's to consume.
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(pg_temp.refused_payload()
   || jsonb_build_object('artifacts', jsonb_build_array(
        jsonb_set(jsonb_set(pg_temp.report_entry(), '{artifact_id}', '"00000000-0000-4000-8000-00000000df12"'),
                  '{object_key}', '"other-report.json"'))));
 RAISE EXCEPTION 'ASSERT FAIL: another parent''s reservation was consumed';
EXCEPTION WHEN SQLSTATE '55017' THEN RAISE NOTICE 'ok a reservation is scoped to its exact parent'; END $$;

-- 4. Nothing durable survived any of that.
DO $$ BEGIN
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_deliveries), 'ASSERT FAIL: a refused publication left a delivery';
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_artifacts), 'ASSERT FAIL: a refused publication minted metadata';
 ASSERT (SELECT count(*) FROM public.scene3d_upload_intents)=3, 'ASSERT FAIL: a refused publication consumed a reservation';
 RAISE NOTICE 'ok every refusal left the reservations and the store untouched';
END $$;

-- 5. The real thing: published with no revision anywhere in the database.
DO $$ BEGIN
 ASSERT public.scene3d_publish_refused_delivery(pg_temp.refused_payload())='created',
   'ASSERT FAIL: a valid refused publication failed';
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_revisions), 'ASSERT FAIL: a refused run published a revision';
 ASSERT (SELECT source_kind FROM public.scene3d_deliveries WHERE job_id='00000000-0000-4000-8000-00000000df04')
   ='refused-authoring', 'ASSERT FAIL: the delivery does not name its source kind';
 -- No plan, so no plan digest; the CHECK binds the two together in both directions.
 ASSERT (SELECT source_plan_sha256 FROM public.scene3d_deliveries WHERE job_id='00000000-0000-4000-8000-00000000df04')
   IS NULL, 'ASSERT FAIL: a refused delivery claimed a plan digest';
 -- Both authorization anchors resolve to the parent itself, which is how the
 -- read route finds it reachable by exactly the people the job is.
 ASSERT (SELECT (source_owner_id, source_workflow_id, source_job_id) FROM public.scene3d_deliveries
   WHERE job_id='00000000-0000-4000-8000-00000000df04')
   = ('00000000-0000-4000-8000-00000000df01'::uuid, '00000000-0000-4000-8000-00000000df03'::uuid,
      '00000000-0000-4000-8000-00000000df04'::uuid), 'ASSERT FAIL: the delivery is not anchored to its parent';
 ASSERT (SELECT count(*) FROM public.scene3d_delivery_artifacts WHERE usage='validation')=1
   AND (SELECT count(*) FROM public.scene3d_delivery_artifacts WHERE usage='checkpoint')=1,
   'ASSERT FAIL: the report and the recipe are not both pinned';
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_upload_intents WHERE artifact_id IN
   ('00000000-0000-4000-8000-00000000df10','00000000-0000-4000-8000-00000000df11')),
   'ASSERT FAIL: publication left its reservations unconsumed';
 RAISE NOTICE 'ok the refusal report and the private recipe are retained with no scene behind them';
END $$;

-- 6. Replay adopts; different bytes do not.
DO $$ BEGIN
 ASSERT public.scene3d_publish_refused_delivery(pg_temp.refused_payload())='unchanged',
   'ASSERT FAIL: an identical republication was not adopted';
 RAISE NOTICE 'ok an identical republication adopts instead of duplicating';
END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(jsonb_set(pg_temp.refused_payload(),
   '{artifacts,0,sha256}', to_jsonb(repeat('f',64))));
 RAISE EXCEPTION 'ASSERT FAIL: a replay replaced the retained findings';
EXCEPTION WHEN SQLSTATE '55010' THEN RAISE NOTICE 'ok a replay refuses different bytes'; END $$;

-- 7. The GC sweep spares the recipe BECAUSE the delivery pins it. Without this
--    the retention is a write nobody can ever read back. `expires_at` is the
--    lever, not `created_at`: an artifact's identity columns are immutable, and
--    expiry is the real lane the sweep collects on anyway.
UPDATE public.scene3d_artifacts SET expires_at = now() - interval '1 hour';
DO $$ BEGIN
 PERFORM public.scene3d_sweep_expired_artifacts(100);
 ASSERT (SELECT count(*) FROM public.scene3d_artifacts)=2,
   'ASSERT FAIL: the sweep collected retained refusal evidence';
 RAISE NOTICE 'ok a delivery pin keeps the refusal evidence out of the sweep';
END $$;

-- 8. The ordering property: a settled parent publishes nothing. This is what a
--    LATE worker hits — the one that lost its lease and finished after the
--    verdict was already written to the row.
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(pg_temp.refused_payload()
   || '{"job_id":"00000000-0000-4000-8000-00000000df05"}');
 RAISE EXCEPTION 'ASSERT FAIL: a settled parent published a refused delivery';
EXCEPTION WHEN SQLSTATE '55016' THEN RAISE NOTICE 'ok a late result cannot publish against a settled job'; END $$;

-- 9. And it never overwrites a delivery the job already published from a scene.
DO $$ BEGIN
 UPDATE public.scene3d_deliveries SET source_kind='job-output', source_plan_sha256=repeat('a',64)
  WHERE job_id='00000000-0000-4000-8000-00000000df04';
 RAISE EXCEPTION 'ASSERT FAIL: a delivery was mutated after publication';
EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'ok a published delivery is immutable'; END $$;
DO $$ BEGIN
 DELETE FROM public.scene3d_delivery_artifacts WHERE job_id='00000000-0000-4000-8000-00000000df04';
 DELETE FROM public.scene3d_deliveries WHERE job_id='00000000-0000-4000-8000-00000000df04';
 -- Not vacuous: unpinned, the very same expired rows ARE collected. The pin in
 -- assertion 7 is what spared them, not the sweep declining to look.
 PERFORM public.scene3d_sweep_expired_artifacts(100);
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_artifacts),
   'ASSERT FAIL: the sweep spares expired evidence even with no delivery pinning it';
 RAISE NOTICE 'ok the pin was what spared them: unpinned, the sweep takes both';
 INSERT INTO public.scene3d_deliveries(job_id, user_id, workflow_id, source_kind, source_revision_id,
   source_plan_sha256, source_owner_id, source_workflow_id, mode)
 VALUES ('00000000-0000-4000-8000-00000000df04','00000000-0000-4000-8000-00000000df01',
   '00000000-0000-4000-8000-00000000df03','retained-revision','00000000-0000-4000-8000-00000000df09',
   repeat('a',64),'00000000-0000-4000-8000-00000000df01','00000000-0000-4000-8000-00000000df03','authored');
END $$;
DO $$ BEGIN
 PERFORM public.scene3d_publish_refused_delivery(pg_temp.refused_payload());
 RAISE EXCEPTION 'ASSERT FAIL: a rendered delivery was overwritten by a refusal';
EXCEPTION WHEN SQLSTATE '55010' THEN RAISE NOTICE 'ok a refusal never overwrites a rendered delivery'; END $$;

-- 10. The plan-digest CHECK binds both directions, so neither kind can drift.
DO $$ BEGIN
 INSERT INTO public.scene3d_deliveries(job_id, user_id, workflow_id, source_kind, source_revision_id,
   source_plan_sha256, source_owner_id, source_workflow_id, mode)
 VALUES ('00000000-0000-4000-8000-00000000df05','00000000-0000-4000-8000-00000000df01',
   '00000000-0000-4000-8000-00000000df03','retained-revision','00000000-0000-4000-8000-00000000df09',
   NULL,'00000000-0000-4000-8000-00000000df01','00000000-0000-4000-8000-00000000df03','authored');
 RAISE EXCEPTION 'ASSERT FAIL: a rendered delivery published without a plan digest';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok only a refused delivery may omit the plan digest'; END $$;

DELETE FROM public.jobs WHERE id='00000000-0000-4000-8000-00000000df04';
DO $$ BEGIN
 ASSERT NOT EXISTS (SELECT FROM public.scene3d_deliveries WHERE job_id='00000000-0000-4000-8000-00000000df04'),
   'ASSERT FAIL: deleting the parent left its delivery';
 RAISE NOTICE 'ok deleting the parent removes the delivery it anchored';
 RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;
ROLLBACK;
