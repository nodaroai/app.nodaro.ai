-- Private copies share the existing immutable pin/GC lifecycle.
BEGIN;
INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-4000-8000-000000003e01', 'scene-input-owner@example.test'),
 ('00000000-0000-4000-8000-000000003e02', 'scene-input-editor@example.test');
SET LOCAL ROLE service_role;
DO $$
DECLARE
 original_owner uuid := '00000000-0000-4000-8000-000000003e01';
 copy_owner uuid := '00000000-0000-4000-8000-000000003e02';
 original_revision uuid := '00000000-0000-4000-8000-000000003e03';
 saved_revision uuid := '00000000-0000-4000-8000-000000003e04';
 manual_revision uuid := '00000000-0000-4000-8000-000000003e05';
 original_asset uuid := '00000000-0000-4000-8000-000000003e06';
 copy_asset uuid := '00000000-0000-4000-8000-000000003e07';
 reservation uuid := '00000000-0000-4000-8000-000000003e08';
BEGIN
 INSERT INTO public.scene3d_upload_intents(artifact_id,user_id,revision_id,kind,bucket,object_key,expires_at,collect_after)
 VALUES(reservation,copy_owner,saved_revision,'input-glb','private-scenes','input-reserved.glb',now()+interval '1 hour',now()+interval '2 hours');
 RAISE NOTICE 'ok private input kind can use the existing reservation lifecycle';

 INSERT INTO public.scene3d_artifacts(id,user_id,kind,bucket,object_key,sha256,byte_length,etag,expires_at) VALUES
 (original_asset,original_owner,'glb','private-scenes','original.glb',repeat('a',64),1024,'original-tag',now()-interval '1 day'),
 (copy_asset,copy_owner,'input-glb','private-scenes','owned-input.glb',repeat('a',64),1024,'copy-tag',now()-interval '1 day');
 INSERT INTO public.scene3d_revisions(id,user_id,plan,plan_sha256)
 SELECT id,owner,jsonb_build_object('planType','3d-scene','schemaVersion',2,'revisionId',id),repeat('b',64)
 FROM (VALUES(original_revision,original_owner),(saved_revision,copy_owner),(manual_revision,copy_owner)) AS revisions(id,owner);
 INSERT INTO public.scene3d_revision_artifacts(revision_id,artifact_id,user_id,usage) VALUES
 (original_revision,original_asset,original_owner,'playback'),
 (saved_revision,copy_asset,copy_owner,'checkpoint'),
 (manual_revision,copy_asset,copy_owner,'checkpoint');
 SET CONSTRAINTS ALL IMMEDIATE;
 BEGIN
  INSERT INTO public.scene3d_revision_artifacts(revision_id,artifact_id,user_id,usage)
  VALUES(saved_revision,original_asset,copy_owner,'checkpoint');
  RAISE EXCEPTION 'ASSERT FAIL: a cross-owner input was pinned without an owned copy';
 EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok cross-owner input pins remain forbidden'; END;

 DELETE FROM public.scene3d_revisions WHERE id=original_revision;
 PERFORM public.scene3d_sweep_expired_artifacts(100);
 IF EXISTS(SELECT 1 FROM public.scene3d_artifacts WHERE id=original_asset)
    OR NOT EXISTS(SELECT 1 FROM public.scene3d_artifacts WHERE id=copy_asset) THEN
  RAISE EXCEPTION 'ASSERT FAIL: source cleanup affected the owned retained input';
 END IF;
 RAISE NOTICE 'ok the owned copy survives deletion and GC of its original source';

 DELETE FROM public.scene3d_revisions WHERE id=saved_revision;
 PERFORM public.scene3d_sweep_expired_artifacts(100);
 IF NOT EXISTS(SELECT 1 FROM public.scene3d_artifacts WHERE id=copy_asset) THEN
  RAISE EXCEPTION 'ASSERT FAIL: a manual revision lost its retained input';
 END IF;
 RAISE NOTICE 'ok a manual edit retains its private input independently';

 DELETE FROM public.scene3d_revisions WHERE id=manual_revision;
 PERFORM public.scene3d_sweep_expired_artifacts(100);
 IF EXISTS(SELECT 1 FROM public.scene3d_artifacts WHERE id=copy_asset)
    OR NOT EXISTS(SELECT 1 FROM public.scene3d_artifact_gc WHERE artifact_id=copy_asset) THEN
  RAISE EXCEPTION 'ASSERT FAIL: an unpinned expired private input was not queued for cleanup';
 END IF;
 RAISE NOTICE 'ok unpinned expired inputs reach the existing durable cleanup queue';
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM * FROM public.scene3d_artifacts WHERE kind='input-glb';
 RAISE EXCEPTION 'ASSERT FAIL: private inputs escaped through the Data API';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok retained inputs remain private'; END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
