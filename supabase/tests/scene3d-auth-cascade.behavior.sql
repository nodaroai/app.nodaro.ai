-- Run after the migration chain. Fixture rows, roles and grants roll back.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin;
  END IF;
END $$;
GRANT USAGE ON SCHEMA auth, public TO supabase_auth_admin;
GRANT SELECT, DELETE ON auth.users TO supabase_auth_admin;

INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-4000-8000-000000003f01', 'scene-cascade-published@example.test'),
 ('00000000-0000-4000-8000-000000003f02', 'scene-cascade-abandoned@example.test'),
 ('00000000-0000-4000-8000-000000003f03', 'scene-cascade-unrelated@example.test');
INSERT INTO public.jobs(id, user_id, status) VALUES
 ('00000000-0000-4000-8000-000000003f04', '00000000-0000-4000-8000-000000003f01', 'processing');
INSERT INTO public.scene3d_artifacts(id, user_id, source_job_id, kind, bucket, object_key, sha256, byte_length, etag) VALUES
 ('00000000-0000-4000-8000-000000003f05', '00000000-0000-4000-8000-000000003f01', '00000000-0000-4000-8000-000000003f04', 'glb', 'private-scenes', 'cascade-published.glb', repeat('a',64), 128, 'published'),
 ('00000000-0000-4000-8000-000000003f06', '00000000-0000-4000-8000-000000003f03', NULL, 'glb', 'private-scenes', 'cascade-unrelated.glb', repeat('b',64), 128, 'unrelated');
INSERT INTO public.scene3d_revisions(id, user_id, source_job_id, plan, plan_sha256)
 SELECT id, '00000000-0000-4000-8000-000000003f01', '00000000-0000-4000-8000-000000003f04',
   jsonb_build_object('planType','3d-scene','schemaVersion',2,'revisionId',id), repeat('c',64)
 FROM (VALUES ('00000000-0000-4000-8000-000000003f07'::uuid),
              ('00000000-0000-4000-8000-000000003f08'::uuid)) AS revisions(id);
INSERT INTO public.scene3d_revision_artifacts(revision_id, artifact_id, user_id, usage) VALUES
 ('00000000-0000-4000-8000-000000003f07', '00000000-0000-4000-8000-000000003f05', '00000000-0000-4000-8000-000000003f01', 'playback'),
 ('00000000-0000-4000-8000-000000003f08', '00000000-0000-4000-8000-000000003f05', '00000000-0000-4000-8000-000000003f01', 'playback');
INSERT INTO public.scene3d_artifact_gc(artifact_id, bucket, object_key, attempts, resolved_at, resolution)
 VALUES ('00000000-0000-4000-8000-000000003f05', 'private-scenes', 'cascade-published.glb', 1, now(), 'kept');
INSERT INTO public.scene3d_upload_intents(artifact_id, user_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
 VALUES ('00000000-0000-4000-8000-000000003f09', '00000000-0000-4000-8000-000000003f02',
   '00000000-0000-4000-8000-000000003f10', 'source-json', 'private-scenes', 'cascade-abandoned.json', now()+interval '1 hour', now()+interval '2 hours');

SET LOCAL ROLE supabase_auth_admin;
DO $$ BEGIN
  PERFORM * FROM public.scene3d_artifact_gc;
  RAISE EXCEPTION 'ASSERT FAIL: auth administration can read private cleanup metadata';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok auth admin has no direct cleanup access'; END $$;
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000003f01';
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000003f02';
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_revisions WHERE user_id = '00000000-0000-4000-8000-000000003f01'), 'ASSERT FAIL: retained revisions survived deletion';
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_revision_artifacts WHERE user_id = '00000000-0000-4000-8000-000000003f01'), 'ASSERT FAIL: pins survived deletion';
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_artifacts WHERE user_id = '00000000-0000-4000-8000-000000003f01'), 'ASSERT FAIL: deleted account retained artifacts';
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_upload_intents WHERE user_id = '00000000-0000-4000-8000-000000003f02'), 'ASSERT FAIL: abandoned reservation survived deletion';
  ASSERT EXISTS(SELECT FROM public.scene3d_artifact_gc WHERE artifact_id = '00000000-0000-4000-8000-000000003f05'
    AND resolution IS NULL AND resolved_at IS NULL AND attempts = 0), 'ASSERT FAIL: kept artifact was not queued again';
  ASSERT EXISTS(SELECT FROM public.scene3d_artifact_gc WHERE artifact_id = '00000000-0000-4000-8000-000000003f09'
    AND resolution IS NULL), 'ASSERT FAIL: abandoned upload lost its cleanup task';
  ASSERT EXISTS(SELECT FROM public.scene3d_artifacts WHERE id = '00000000-0000-4000-8000-000000003f06'), 'ASSERT FAIL: unrelated artifact was removed';
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_artifact_gc WHERE artifact_id = '00000000-0000-4000-8000-000000003f06'), 'ASSERT FAIL: unrelated artifact was queued for deletion';
  ASSERT NOT has_function_privilege('anon', 'public.scene3d_enqueue_artifact_gc()', 'execute'), 'ASSERT FAIL: anonymous trigger execution granted';
  ASSERT NOT has_function_privilege('authenticated', 'public.scene3d_enqueue_intent_gc()', 'execute'), 'ASSERT FAIL: authenticated trigger execution granted';
  ASSERT (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=""']) FROM pg_proc WHERE oid IN
    ('public.scene3d_enqueue_artifact_gc()'::regprocedure, 'public.scene3d_enqueue_intent_gc()'::regprocedure)), 'ASSERT FAIL: cleanup context is not confined';
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;
ROLLBACK;
