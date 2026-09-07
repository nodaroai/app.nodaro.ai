-- Execute after the migration chain. All fixture writes roll back.
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-000000003d01', 'scene-owner@example.test'),
  ('00000000-0000-4000-8000-000000003d02', 'scene-other@example.test');
INSERT INTO public.projects(id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000003d03', '00000000-0000-4000-8000-000000003d01', 'Scene proof');
INSERT INTO public.workflows(id, user_id, project_id, name) VALUES
  ('00000000-0000-4000-8000-000000003d04', '00000000-0000-4000-8000-000000003d01', '00000000-0000-4000-8000-000000003d03', 'Original'),
  ('00000000-0000-4000-8000-000000003d05', '00000000-0000-4000-8000-000000003d01', '00000000-0000-4000-8000-000000003d03', 'Retained copy');

SET LOCAL ROLE service_role;
INSERT INTO public.scene3d_artifacts(id, user_id, kind, bucket, object_key, sha256, byte_length, etag) VALUES
  ('00000000-0000-4000-8000-000000003d06', '00000000-0000-4000-8000-000000003d01', 'glb', 'private-scenes', 'scene.glb', repeat('a',64), 1024, '"tag-a"'),
  ('00000000-0000-4000-8000-000000003d07', '00000000-0000-4000-8000-000000003d02', 'glb', 'private-scenes', 'foreign.glb', repeat('b',64), 1024, '"tag-b"');
INSERT INTO public.scene3d_revisions(id, user_id, workflow_id, plan, plan_sha256)
SELECT id, '00000000-0000-4000-8000-000000003d01', workflow_id,
  jsonb_build_object('planType','3d-scene','schemaVersion',2,'revisionId',id), repeat('c',64)
FROM (VALUES
  ('00000000-0000-4000-8000-000000003d08'::uuid, '00000000-0000-4000-8000-000000003d04'::uuid),
  ('00000000-0000-4000-8000-000000003d09'::uuid, '00000000-0000-4000-8000-000000003d05'::uuid)
) AS revisions(id, workflow_id);
INSERT INTO public.scene3d_revision_artifacts(revision_id, artifact_id, user_id, usage) VALUES
  ('00000000-0000-4000-8000-000000003d08', '00000000-0000-4000-8000-000000003d06', '00000000-0000-4000-8000-000000003d01', 'playback'),
  ('00000000-0000-4000-8000-000000003d09', '00000000-0000-4000-8000-000000003d06', '00000000-0000-4000-8000-000000003d01', 'playback');

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM * FROM public.scene3d_artifacts;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could read private object keys';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok authenticated cannot bypass the artifact API'; END $$;
DO $$ BEGIN
  PERFORM * FROM public.scene3d_revisions;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated could read another user revision';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok revision metadata requires API authorization'; END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM * FROM public.scene3d_artifact_gc;
  RAISE EXCEPTION 'ASSERT FAIL: anon could read deleted private object keys';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok anonymous cleanup metadata is inaccessible'; END $$;
RESET ROLE;

SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  INSERT INTO public.scene3d_revision_artifacts(revision_id, artifact_id, user_id, usage) VALUES
    ('00000000-0000-4000-8000-000000003d08', '00000000-0000-4000-8000-000000003d07', '00000000-0000-4000-8000-000000003d01', 'playback');
  RAISE EXCEPTION 'ASSERT FAIL: a foreign artifact was substituted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok foreign artifact substitution is rejected'; END $$;
DO $$ BEGIN
  DELETE FROM public.scene3d_artifacts WHERE id = '00000000-0000-4000-8000-000000003d06';
  RAISE EXCEPTION 'ASSERT FAIL: retained artifact was deleted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok retained revisions pin their artifacts'; END $$;
DO $$ BEGIN
  UPDATE public.scene3d_revisions SET plan = plan || '{"changed":true}' WHERE id = '00000000-0000-4000-8000-000000003d08';
  RAISE EXCEPTION 'ASSERT FAIL: revision was mutated';
EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'ok accepted revision is immutable'; END $$;
DO $$ BEGIN
  UPDATE public.scene3d_artifacts SET sha256 = repeat('d',64) WHERE id = '00000000-0000-4000-8000-000000003d06';
  RAISE EXCEPTION 'ASSERT FAIL: artifact bytes could be substituted';
EXCEPTION WHEN SQLSTATE '55000' THEN RAISE NOTICE 'ok artifact content binding is immutable'; END $$;
DO $$ BEGIN
  INSERT INTO public.scene3d_revisions(id, user_id, plan, plan_sha256) VALUES
    ('00000000-0000-4000-8000-000000003d10', '00000000-0000-4000-8000-000000003d01', '{}', repeat('e',64));
  RAISE EXCEPTION 'ASSERT FAIL: missing identity fields passed SQL NULL checks';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok malformed manifest identity is rejected'; END $$;
SET CONSTRAINTS ALL DEFERRED;

DELETE FROM public.workflows WHERE id = '00000000-0000-4000-8000-000000003d04';
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_revisions WHERE id = '00000000-0000-4000-8000-000000003d08'), 'ASSERT FAIL: deleted workflow retained its revision';
  ASSERT EXISTS(SELECT FROM public.scene3d_revision_artifacts WHERE revision_id = '00000000-0000-4000-8000-000000003d09'), 'ASSERT FAIL: deleting original removed retained copy';
  ASSERT EXISTS(SELECT FROM public.scene3d_artifacts WHERE id = '00000000-0000-4000-8000-000000003d06'), 'ASSERT FAIL: retained bytes were removed';
  RAISE NOTICE 'ok workflow deletion revokes its revision without deleting another revision assets';
END $$;
DELETE FROM public.workflows WHERE id = '00000000-0000-4000-8000-000000003d05';
DELETE FROM public.scene3d_artifacts WHERE id = '00000000-0000-4000-8000-000000003d06';
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000003d02';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.scene3d_artifact_gc WHERE artifact_id IN
    ('00000000-0000-4000-8000-000000003d06','00000000-0000-4000-8000-000000003d07')) = 2,
    'ASSERT FAIL: cleanup was lost after metadata/user deletion';
  RAISE NOTICE 'ok cleanup tasks survive metadata and user deletion';
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Publication, replay, sweep and cleanup-claim behaviour.
-- ---------------------------------------------------------------------------
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-000000003d20', 'publish-owner@example.test'),
  ('00000000-0000-4000-8000-000000003d21', 'publish-other@example.test');
INSERT INTO public.projects(id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000003d22', '00000000-0000-4000-8000-000000003d20', 'Publish proof');
INSERT INTO public.workflows(id, user_id, project_id, name) VALUES
  ('00000000-0000-4000-8000-000000003d23', '00000000-0000-4000-8000-000000003d20', '00000000-0000-4000-8000-000000003d22', 'Scene');

SET LOCAL ROLE service_role;

CREATE OR REPLACE FUNCTION pg_temp.publish_payload(
  revision uuid, owner uuid, artifact uuid, digest text, tag text, reuse boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object(
    'revision_id', revision, 'user_id', owner,
    'workflow_id', '00000000-0000-4000-8000-000000003d23',
    'plan', jsonb_build_object('planType', '3d-scene', 'schemaVersion', 2, 'revisionId', revision),
    'plan_sha256', repeat('c', 64),
    'artifacts', jsonb_build_array(jsonb_build_object(
      'artifact_id', artifact, 'kind', 'glb', 'usage', 'playback',
      'bucket', 'private-scenes', 'object_key', 'scene3d/' || owner || '/' || revision || '/' || artifact || '.glb',
      'sha256', digest, 'byte_length', 2048, 'etag', tag, 'reuse', reuse)))
$fn$;

DO $$ BEGIN
  ASSERT public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d24', '00000000-0000-4000-8000-000000003d20',
    '00000000-0000-4000-8000-000000003d25', repeat('a', 64), '"tag-1"')) = 'created',
    'ASSERT FAIL: first publication did not create the revision';
  ASSERT (SELECT count(*) FROM public.scene3d_revision_artifacts
          WHERE revision_id = '00000000-0000-4000-8000-000000003d24') = 1,
    'ASSERT FAIL: publication did not pin its asset';
  RAISE NOTICE 'ok publication writes manifest, artifact and pin in one transaction';
END $$;

DO $$ BEGIN
  ASSERT public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d24', '00000000-0000-4000-8000-000000003d20',
    '00000000-0000-4000-8000-000000003d25', repeat('a', 64), '"tag-1"')) = 'unchanged',
    'ASSERT FAIL: identical replay was not idempotent';
  RAISE NOTICE 'ok replaying the same revision with the same bytes is a no-op';
END $$;

DO $$ BEGIN
  PERFORM public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d24', '00000000-0000-4000-8000-000000003d20',
    '00000000-0000-4000-8000-000000003d25', repeat('f', 64), '"tag-2"'));
  RAISE EXCEPTION 'ASSERT FAIL: a revision was republished with different bytes';
EXCEPTION WHEN SQLSTATE '55012' THEN RAISE NOTICE 'ok replay with different bytes is refused'; END $$;

DO $$ BEGIN
  PERFORM public.scene3d_publish_revision(
    pg_temp.publish_payload('00000000-0000-4000-8000-000000003d24', '00000000-0000-4000-8000-000000003d20',
      '00000000-0000-4000-8000-000000003d29', repeat('e', 64), '"tag-9"')
    || jsonb_build_object('plan_sha256', repeat('d', 64)));
  RAISE EXCEPTION 'ASSERT FAIL: a revision was republished with a different plan';
EXCEPTION WHEN SQLSTATE '55010' THEN RAISE NOTICE 'ok replay with a different manifest is refused'; END $$;

DO $$ BEGIN
  PERFORM public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d2a', '00000000-0000-4000-8000-000000003d21',
    '00000000-0000-4000-8000-000000003d25', repeat('a', 64), '"tag-1"'));
  RAISE EXCEPTION 'ASSERT FAIL: another owner pinned this owner artifact';
EXCEPTION WHEN SQLSTATE '55011' THEN RAISE NOTICE 'ok a cross-owner pin is refused before it can be written'; END $$;

DO $$ BEGIN
  PERFORM public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d2b', '00000000-0000-4000-8000-000000003d20',
    '00000000-0000-4000-8000-000000003d2c', repeat('9', 64), '"tag-3"', true));
  RAISE EXCEPTION 'ASSERT FAIL: a manifest reused bytes that do not exist';
EXCEPTION WHEN SQLSTATE '55013' THEN RAISE NOTICE 'ok reusing a collected artifact is refused'; END $$;

DO $$
DECLARE v_before integer; v_removed integer;
BEGIN
  INSERT INTO public.scene3d_artifacts(id, user_id, kind, bucket, object_key, sha256, byte_length, etag, expires_at)
  VALUES ('00000000-0000-4000-8000-000000003d2d', '00000000-0000-4000-8000-000000003d20', 'poster',
          'private-scenes', 'scene3d/expired.png', repeat('7', 64), 32, '"tag-4"', now() - interval '1 day');
  UPDATE public.scene3d_artifacts SET expires_at = now() - interval '1 day'
    WHERE id = '00000000-0000-4000-8000-000000003d25';
  SELECT count(*) INTO v_before FROM public.scene3d_artifacts;
  SELECT public.scene3d_sweep_expired_artifacts(50) INTO v_removed;
  ASSERT v_removed = 1, 'ASSERT FAIL: the sweep removed the wrong number of artifacts';
  ASSERT EXISTS(SELECT FROM public.scene3d_artifacts WHERE id = '00000000-0000-4000-8000-000000003d25'),
    'ASSERT FAIL: the sweep deleted an artifact a live revision pins';
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_artifacts WHERE id = '00000000-0000-4000-8000-000000003d2d'),
    'ASSERT FAIL: the sweep kept an expired unpinned artifact';
  ASSERT EXISTS(SELECT FROM public.scene3d_artifact_gc WHERE artifact_id = '00000000-0000-4000-8000-000000003d2d'),
    'ASSERT FAIL: sweeping an artifact did not leave a durable cleanup task';
  RAISE NOTICE 'ok the sweep respects live pins and leaves a cleanup task behind';
END $$;

DO $$
DECLARE v_first integer; v_second integer;
BEGIN
  SELECT count(*) INTO v_first FROM public.scene3d_claim_artifact_gc(50, interval '10 minutes');
  ASSERT v_first = 1, 'ASSERT FAIL: the cleanup task was not claimable';
  SELECT count(*) INTO v_second FROM public.scene3d_claim_artifact_gc(50, interval '10 minutes');
  ASSERT v_second = 0, 'ASSERT FAIL: a just-claimed cleanup task was handed out twice';
  ASSERT (SELECT attempts FROM public.scene3d_artifact_gc
          WHERE artifact_id = '00000000-0000-4000-8000-000000003d2d') = 1,
    'ASSERT FAIL: the claim did not record an attempt';
  -- Backdate rather than sleep: proving "an abandoned attempt ages out" by
  -- claiming twice in a row makes the assertion a race against the clock's
  -- resolution, and a flaky proof of a durability property is worse than none.
  UPDATE public.scene3d_artifact_gc SET last_attempt_at = clock_timestamp() - interval '1 hour';
  SELECT count(*) INTO v_second FROM public.scene3d_claim_artifact_gc(50, interval '10 minutes');
  ASSERT v_second = 1, 'ASSERT FAIL: an abandoned cleanup task was never retried';
  ASSERT (SELECT attempts FROM public.scene3d_artifact_gc
          WHERE artifact_id = '00000000-0000-4000-8000-000000003d2d') = 2,
    'ASSERT FAIL: the retry did not record a second attempt';
  RAISE NOTICE 'ok cleanup tasks are claimed once and retried after an abandoned attempt';
  RAISE NOTICE 'ALL PUBLICATION ASSERTIONS PASSED';
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- Upload reservations: consumption, expiry, and the publication/cleanup race.
-- ---------------------------------------------------------------------------
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-4000-8000-000000003d40', 'intent-owner@example.test');
INSERT INTO public.projects(id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000003d42', '00000000-0000-4000-8000-000000003d40', 'Intent proof');
INSERT INTO public.workflows(id, user_id, project_id, name) VALUES
  ('00000000-0000-4000-8000-000000003d43', '00000000-0000-4000-8000-000000003d40', '00000000-0000-4000-8000-000000003d42', 'Scene');
INSERT INTO public.jobs(id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000003d41', '00000000-0000-4000-8000-000000003d40', 'processing');

SET LOCAL ROLE service_role;

CREATE OR REPLACE FUNCTION pg_temp.intent_key(revision uuid, artifact uuid) RETURNS text LANGUAGE sql AS $fn$
  SELECT 'scene3d/00000000-0000-4000-8000-000000003d40/' || revision || '/' || artifact || '.glb'
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.publish_payload(revision uuid, artifact uuid, require_intents boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object(
    'revision_id', revision, 'user_id', '00000000-0000-4000-8000-000000003d40',
    'workflow_id', '00000000-0000-4000-8000-000000003d43',
    'source_job_id', '00000000-0000-4000-8000-000000003d41',
    'require_intents', require_intents,
    'plan', jsonb_build_object('planType', '3d-scene', 'schemaVersion', 2, 'revisionId', revision),
    'plan_sha256', repeat('c', 64),
    'artifacts', jsonb_build_array(jsonb_build_object(
      'artifact_id', artifact, 'kind', 'glb', 'usage', 'playback',
      'bucket', 'private-scenes', 'object_key', pg_temp.intent_key(revision, artifact),
      'sha256', repeat('a', 64), 'byte_length', 2048, 'etag', '"tag-1"')))
$fn$;

DO $$ BEGIN
  INSERT INTO public.scene3d_upload_intents
    (artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
  VALUES ('00000000-0000-4000-8000-000000003d45', '00000000-0000-4000-8000-000000003d40',
          '00000000-0000-4000-8000-000000003d41', '00000000-0000-4000-8000-000000003d44', 'glb',
          'private-scenes',
          pg_temp.intent_key('00000000-0000-4000-8000-000000003d44', '00000000-0000-4000-8000-000000003d45'),
          now() + interval '15 minutes', now() + interval '75 minutes');

  ASSERT public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d44', '00000000-0000-4000-8000-000000003d45')) = 'created',
    'ASSERT FAIL: a reserved upload could not be published';
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_upload_intents
    WHERE artifact_id = '00000000-0000-4000-8000-000000003d45'),
    'ASSERT FAIL: publication did not consume its reservation';
  ASSERT NOT EXISTS(SELECT FROM public.scene3d_artifact_gc
    WHERE artifact_id = '00000000-0000-4000-8000-000000003d45'),
    'ASSERT FAIL: consuming a reservation queued a deletion for published bytes';
  RAISE NOTICE 'ok publishing consumes its reservation and never queues its own bytes for deletion';
END $$;

DO $$
DECLARE v_removed integer;
BEGIN
  INSERT INTO public.scene3d_upload_intents
    (artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
  VALUES ('00000000-0000-4000-8000-000000003d46', '00000000-0000-4000-8000-000000003d40',
          '00000000-0000-4000-8000-000000003d41', '00000000-0000-4000-8000-000000003d44', 'glb',
          'private-scenes', 'scene3d/abandoned.glb',
          now() - interval '30 minutes', now() - interval '1 minute');

  SELECT public.scene3d_sweep_expired_upload_intents(10) INTO v_removed;
  ASSERT v_removed = 1, 'ASSERT FAIL: an abandoned upload was not swept';
  ASSERT EXISTS(SELECT FROM public.scene3d_artifact_gc
    WHERE artifact_id = '00000000-0000-4000-8000-000000003d46'),
    'ASSERT FAIL: a swept upload left no cleanup task, so its bytes are orphaned';
  RAISE NOTICE 'ok an upload that never published becomes collectable after its grace period';
END $$;

DO $$
DECLARE v_claimed integer;
BEGIN
  -- A cleanup task naming a key a live artifact owns can only come from a
  -- sweep that raced a publication. It must never be handed to a worker.
  INSERT INTO public.scene3d_artifact_gc(artifact_id, bucket, object_key)
  VALUES ('00000000-0000-4000-8000-000000003d45', 'private-scenes',
          pg_temp.intent_key('00000000-0000-4000-8000-000000003d44', '00000000-0000-4000-8000-000000003d45'));

  SELECT count(*) INTO v_claimed FROM public.scene3d_claim_artifact_gc(10, interval '10 minutes');
  ASSERT v_claimed = 1, 'ASSERT FAIL: the claim handed out the wrong number of tasks';
  ASSERT (SELECT resolution FROM public.scene3d_artifact_gc
          WHERE artifact_id = '00000000-0000-4000-8000-000000003d45') = 'kept',
    'ASSERT FAIL: published bytes were left queued for deletion';
  RAISE NOTICE 'ok bytes a published artifact names are never handed to a cleanup worker';
END $$;

-- An artifact id is retired the moment cleanup knows about it. These two are
-- the orderings a presence check at claim time cannot rescue: a sweep that
-- lands between a grant and its retry, and a worker holding a claim it has not
-- executed yet while a new grant is minted for the same key.
DO $$
DECLARE v_key text := 'scene3d/abandoned.glb';
BEGIN
  BEGIN
    PERFORM public.scene3d_reserve_upload(jsonb_build_object(
      'artifact_id', '00000000-0000-4000-8000-000000003d46',
      'user_id', '00000000-0000-4000-8000-000000003d40',
      'job_id', '00000000-0000-4000-8000-000000003d41',
      'revision_id', '00000000-0000-4000-8000-000000003d44',
      'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
      'expires_at', now() + interval '15 minutes', 'collect_after', now() + interval '75 minutes'));
    RAISE EXCEPTION 'ASSERT FAIL: a swept upload was re-granted for the same key';
  EXCEPTION WHEN SQLSTATE '55019' THEN NULL; END;
  RAISE NOTICE 'ok a swept upload cannot be re-granted, so cleanup cannot delete fresh bytes';
END $$;

DO $$
DECLARE v_claimed integer; v_key text := 'scene3d/claimed.glb';
BEGIN
  INSERT INTO public.scene3d_upload_intents
    (artifact_id, user_id, job_id, revision_id, kind, bucket, object_key, expires_at, collect_after)
  VALUES ('00000000-0000-4000-8000-000000003d50', '00000000-0000-4000-8000-000000003d40',
          '00000000-0000-4000-8000-000000003d41', '00000000-0000-4000-8000-000000003d44', 'glb',
          'private-scenes', v_key, now() - interval '30 minutes', now() - interval '1 minute');
  PERFORM public.scene3d_sweep_expired_upload_intents(10);
  SELECT count(*) INTO v_claimed FROM public.scene3d_claim_artifact_gc(10, interval '10 minutes');
  ASSERT v_claimed >= 1, 'ASSERT FAIL: the swept upload produced no cleanup task';

  -- The worker is holding the claim and has not deleted anything yet.
  BEGIN
    PERFORM public.scene3d_reserve_upload(jsonb_build_object(
      'artifact_id', '00000000-0000-4000-8000-000000003d50',
      'user_id', '00000000-0000-4000-8000-000000003d40',
      'job_id', '00000000-0000-4000-8000-000000003d41',
      'revision_id', '00000000-0000-4000-8000-000000003d44',
      'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
      'expires_at', now() + interval '15 minutes', 'collect_after', now() + interval '75 minutes'));
    RAISE EXCEPTION 'ASSERT FAIL: a claimed cleanup task did not retire its artifact id';
  EXCEPTION WHEN SQLSTATE '55019' THEN NULL; END;

  BEGIN
    PERFORM public.scene3d_publish_revision(
      pg_temp.publish_payload('00000000-0000-4000-8000-000000003d51',
                              '00000000-0000-4000-8000-000000003d50')
      || jsonb_build_object('artifacts', jsonb_build_array(jsonb_build_object(
           'artifact_id', '00000000-0000-4000-8000-000000003d50', 'kind', 'glb', 'usage', 'playback',
           'bucket', 'private-scenes', 'object_key', v_key,
           'sha256', repeat('a', 64), 'byte_length', 2048, 'etag', '"tag-1"'))));
    RAISE EXCEPTION 'ASSERT FAIL: a retired artifact id was republished';
  EXCEPTION WHEN SQLSTATE '55019' THEN NULL; END;

  -- ...and acknowledging the delete does not bring the id back.
  ASSERT public.scene3d_complete_artifact_gc('00000000-0000-4000-8000-000000003d50'),
    'ASSERT FAIL: completing cleanup did not resolve the task';
  ASSERT (SELECT count(*) FROM public.scene3d_claim_artifact_gc(10, interval '0 seconds')
          WHERE artifact_id = '00000000-0000-4000-8000-000000003d50') = 0,
    'ASSERT FAIL: a completed cleanup task was handed out again';
  BEGIN
    PERFORM public.scene3d_reserve_upload(jsonb_build_object(
      'artifact_id', '00000000-0000-4000-8000-000000003d50',
      'user_id', '00000000-0000-4000-8000-000000003d40',
      'job_id', '00000000-0000-4000-8000-000000003d41',
      'revision_id', '00000000-0000-4000-8000-000000003d44',
      'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
      'expires_at', now() + interval '15 minutes', 'collect_after', now() + interval '75 minutes'));
    RAISE EXCEPTION 'ASSERT FAIL: a deleted artifact id was revived after acknowledgement';
  EXCEPTION WHEN SQLSTATE '55019' THEN NULL; END;
  RAISE NOTICE 'ok a retired artifact id stays retired, before and after the object is deleted';
END $$;

DO $$
DECLARE v_first jsonb; v_second jsonb; v_key text := 'scene3d/regrant.glb';
BEGIN
  v_first := public.scene3d_reserve_upload(jsonb_build_object(
    'artifact_id', '00000000-0000-4000-8000-000000003d52',
    'user_id', '00000000-0000-4000-8000-000000003d40',
    'job_id', '00000000-0000-4000-8000-000000003d41',
    'revision_id', '00000000-0000-4000-8000-000000003d44',
    'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
    'expires_at', now() + interval '1 minute', 'collect_after', now() + interval '61 minutes'));
  v_second := public.scene3d_reserve_upload(jsonb_build_object(
    'artifact_id', '00000000-0000-4000-8000-000000003d52',
    'user_id', '00000000-0000-4000-8000-000000003d40',
    'job_id', '00000000-0000-4000-8000-000000003d41',
    'revision_id', '00000000-0000-4000-8000-000000003d44',
    'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
    'expires_at', now() + interval '25 minutes', 'collect_after', now() + interval '85 minutes'));
  ASSERT (v_second->>'expires_at')::timestamptz > (v_first->>'expires_at')::timestamptz,
    'ASSERT FAIL: re-granting did not extend the reservation window';

  BEGIN
    PERFORM public.scene3d_reserve_upload(jsonb_build_object(
      'artifact_id', '00000000-0000-4000-8000-000000003d52',
      'user_id', '00000000-0000-4000-8000-000000003d40',
      'job_id', '00000000-0000-4000-8000-000000003d53',
      'revision_id', '00000000-0000-4000-8000-000000003d44',
      'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
      'expires_at', now() + interval '15 minutes', 'collect_after', now() + interval '75 minutes'));
    RAISE EXCEPTION 'ASSERT FAIL: another job took over an existing reservation';
  EXCEPTION WHEN SQLSTATE '55021' THEN NULL; END;
  RAISE NOTICE 'ok a re-grant extends the same reservation and refuses a different job';
END $$;

DO $$
DECLARE v_row jsonb; v_key text := 'scene3d/regrant.glb';
BEGIN
  BEGIN
    PERFORM public.scene3d_record_upload_receipt(jsonb_build_object(
      'artifact_id', '00000000-0000-4000-8000-000000003d54',
      'user_id', '00000000-0000-4000-8000-000000003d40',
      'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
      'sha256', repeat('1', 64), 'byte_length', 10, 'etag', 'e'));
    RAISE EXCEPTION 'ASSERT FAIL: a receipt was recorded without a reservation';
  EXCEPTION WHEN SQLSTATE '55023' THEN NULL; END;

  v_row := public.scene3d_record_upload_receipt(jsonb_build_object(
    'artifact_id', '00000000-0000-4000-8000-000000003d52',
    'user_id', '00000000-0000-4000-8000-000000003d40',
    'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
    'sha256', repeat('1', 64), 'byte_length', 10, 'etag', 'e'));
  ASSERT v_row->>'receipt_sha256' = repeat('1', 64), 'ASSERT FAIL: the receipt was not recorded';

  BEGIN
    PERFORM public.scene3d_record_upload_receipt(jsonb_build_object(
      'artifact_id', '00000000-0000-4000-8000-000000003d52',
      'user_id', '00000000-0000-4000-8000-000000003d40',
      'kind', 'glb', 'bucket', 'private-scenes', 'object_key', v_key,
      'sha256', repeat('2', 64), 'byte_length', 10, 'etag', 'e'));
    RAISE EXCEPTION 'ASSERT FAIL: a second receipt overwrote the first';
  EXCEPTION WHEN SQLSTATE '55024' THEN NULL; END;

  BEGIN
    PERFORM public.scene3d_record_upload_receipt(jsonb_build_object(
      'artifact_id', '00000000-0000-4000-8000-000000003d52',
      'user_id', '00000000-0000-4000-8000-000000003d40',
      'kind', 'poster', 'bucket', 'private-scenes', 'object_key', v_key,
      'sha256', repeat('1', 64), 'byte_length', 10, 'etag', 'e'));
    RAISE EXCEPTION 'ASSERT FAIL: a receipt was accepted outside its reserved scope';
  EXCEPTION WHEN SQLSTATE '55021' THEN NULL; END;
  RAISE NOTICE 'ok a receipt is written once, in scope, and never silently replaced';
END $$;

DO $$ BEGIN
  UPDATE public.jobs SET status = 'cancelled' WHERE id = '00000000-0000-4000-8000-000000003d41';
  BEGIN
    PERFORM public.scene3d_publish_revision(pg_temp.publish_payload(
      '00000000-0000-4000-8000-000000003d48', '00000000-0000-4000-8000-000000003d49'));
    RAISE EXCEPTION 'ASSERT FAIL: a cancelled job published a new scene';
  EXCEPTION WHEN SQLSTATE '55016' THEN NULL; END;

  ASSERT public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d44', '00000000-0000-4000-8000-000000003d45')) = 'unchanged',
    'ASSERT FAIL: cancelling the job broke replay of a revision that already published';
  RAISE NOTICE 'ok cancellation stops new publication and leaves finished ones replayable';
END $$;

DO $$ BEGIN
  UPDATE public.jobs SET status = 'processing' WHERE id = '00000000-0000-4000-8000-000000003d41';
  PERFORM public.scene3d_publish_revision(pg_temp.publish_payload(
    '00000000-0000-4000-8000-000000003d4a', '00000000-0000-4000-8000-000000003d4b', true));
  RAISE EXCEPTION 'ASSERT FAIL: unreserved bytes were published under require_intents';
EXCEPTION WHEN SQLSTATE '55018' THEN
  RAISE NOTICE 'ok require_intents refuses bytes no reservation covers';
END $$;

-- Reusing bytes an earlier revision already published is not an upload, so the
-- strict mode that governs uploads must not ask it for a reservation.
DO $$ BEGIN
  -- The block above rolled its own status change back when it caught 55018.
  UPDATE public.jobs SET status = 'processing' WHERE id = '00000000-0000-4000-8000-000000003d41';
  ASSERT public.scene3d_publish_revision(
    pg_temp.publish_payload('00000000-0000-4000-8000-000000003d56',
                            '00000000-0000-4000-8000-000000003d45', true)
    || jsonb_build_object('artifacts', jsonb_build_array(jsonb_build_object(
         'artifact_id', '00000000-0000-4000-8000-000000003d45', 'kind', 'glb', 'usage', 'playback',
         'bucket', 'private-scenes',
         'object_key', pg_temp.intent_key('00000000-0000-4000-8000-000000003d44',
                                          '00000000-0000-4000-8000-000000003d45'),
         'sha256', repeat('a', 64), 'byte_length', 2048, 'etag', '"tag-1"',
         'reuse', true)))) = 'created',
    'ASSERT FAIL: a revision that only reuses retained bytes was refused';
  RAISE NOTICE 'ok reusing retained bytes needs no upload reservation';
END $$;

-- A 'kept' verdict is about the moment it was taken. When the artifact it was
-- protecting is deleted later, its bytes must become collectable again rather
-- than being orphaned by their own tombstone.
DO $$ BEGIN
  ASSERT (SELECT resolution FROM public.scene3d_artifact_gc
          WHERE artifact_id = '00000000-0000-4000-8000-000000003d45') = 'kept',
    'ASSERT FAIL: the fixture no longer has a kept tombstone to re-open';
  DELETE FROM public.scene3d_revisions
    WHERE id IN ('00000000-0000-4000-8000-000000003d44', '00000000-0000-4000-8000-000000003d56');
  DELETE FROM public.scene3d_artifacts WHERE id = '00000000-0000-4000-8000-000000003d45';

  ASSERT (SELECT resolved_at FROM public.scene3d_artifact_gc
          WHERE artifact_id = '00000000-0000-4000-8000-000000003d45') IS NULL,
    'ASSERT FAIL: a kept tombstone swallowed the artifact deletion that followed it';
  ASSERT (SELECT count(*) FROM public.scene3d_claim_artifact_gc(10, interval '0 seconds')
          WHERE artifact_id = '00000000-0000-4000-8000-000000003d45') = 1,
    'ASSERT FAIL: the re-opened cleanup task was not claimable';
  RAISE NOTICE 'ok deleting a kept artifact re-opens its cleanup task';
  RAISE NOTICE 'ALL RESERVATION ASSERTIONS PASSED';
END $$;

ROLLBACK;
