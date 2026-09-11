-- 3D Render Pro delivers one still per shot alongside the MP4.
--
-- A delivery has always pinned exactly two or three artifacts: one poster and
-- one or two validation reports. A shot still is a THIRD kind of delivery pin,
-- and unlike the other two there are N of them — one per shot of the exported
-- composition, each identified by the shot's 0-based index and its own first
-- frame in the composition's frame space.
--
-- The identity lives in COLUMNS, not in a JSON blob: the "one artifact per
-- shot" and "one artifact per frame" rules are what make the published
-- `shotStills` list meaningful, and a rule that is only enforced in
-- application code is a rule that a replay, a retry or a future producer can
-- walk around. Two partial unique indexes make the database refuse the second
-- pin for a shot before any credit is settled.

-- A shot still is bytes like any other artifact: it needs its own kind on both
-- the reservation and the stored-artifact tables (the producer reserves an
-- upload intent first, so the intents CHECK is the one it hits first).
ALTER TABLE public.scene3d_artifacts DROP CONSTRAINT IF EXISTS scene3d_artifacts_kind_check;
ALTER TABLE public.scene3d_artifacts ADD CONSTRAINT scene3d_artifacts_kind_check
  CHECK (kind IN ('glb', 'camera-track-json', 'poster', 'validation-report', 'blend-source', 'source-json', 'build-manifest', 'input-glb', 'shot-still'));
ALTER TABLE public.scene3d_upload_intents DROP CONSTRAINT IF EXISTS scene3d_upload_intents_kind_check;
ALTER TABLE public.scene3d_upload_intents ADD CONSTRAINT scene3d_upload_intents_kind_check
  CHECK (kind IN ('glb', 'camera-track-json', 'poster', 'validation-report', 'blend-source', 'source-json', 'build-manifest', 'input-glb', 'shot-still'));

ALTER TABLE public.scene3d_delivery_artifacts DROP CONSTRAINT IF EXISTS scene3d_delivery_artifacts_usage_check;
ALTER TABLE public.scene3d_delivery_artifacts ADD CONSTRAINT scene3d_delivery_artifacts_usage_check
  CHECK (usage IN ('poster', 'validation', 'shot-still'));

ALTER TABLE public.scene3d_delivery_artifacts
  ADD COLUMN IF NOT EXISTS shot_index integer,
  ADD COLUMN IF NOT EXISTS frame integer,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer;

-- Biconditional on purpose: a shot still without its shot identity is
-- unpublishable, and a poster carrying one is a mis-labelled still.
ALTER TABLE public.scene3d_delivery_artifacts DROP CONSTRAINT IF EXISTS scene3d_delivery_shot_still_identity;
ALTER TABLE public.scene3d_delivery_artifacts ADD CONSTRAINT scene3d_delivery_shot_still_identity
  CHECK (
    (usage = 'shot-still')
      = (shot_index IS NOT NULL AND frame IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)
    AND (shot_index IS NULL OR shot_index >= 0)
    AND (frame IS NULL OR frame >= 0)
    AND (width IS NULL OR width > 0)
    AND (height IS NULL OR height > 0)
  );

-- One still per shot, and one still per frame, per delivery.
CREATE UNIQUE INDEX IF NOT EXISTS scene3d_delivery_one_still_per_shot
  ON public.scene3d_delivery_artifacts(job_id, shot_index) WHERE usage = 'shot-still';
CREATE UNIQUE INDEX IF NOT EXISTS scene3d_delivery_one_still_per_frame
  ON public.scene3d_delivery_artifacts(job_id, frame) WHERE usage = 'shot-still';

-- Republished with the shot-still lane. Everything else is verbatim from 390:
-- the parent row lock, the exact-replay comparison, the reuse rules and the
-- upload-intent consumption are unchanged.
CREATE OR REPLACE FUNCTION public.scene3d_publish_delivery(payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_job_id uuid := (payload->>'job_id')::uuid;
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_source_id uuid := (payload->>'source_revision_id')::uuid;
  v_source_job_id uuid := nullif(payload->>'source_job_id', '')::uuid;
  v_source_owner uuid := (payload->>'source_owner_id')::uuid;
  v_source_workflow uuid := nullif(payload->>'source_workflow_id', '')::uuid;
  v_kind text := payload->>'source_kind';
  v_plan_hash text := payload->>'source_plan_sha256';
  v_content_hash text := payload->>'source_content_hash';
  v_mode text := payload->>'mode';
  v_entries jsonb := payload->'artifacts';
  v_stills integer;
  v_job public.jobs%ROWTYPE;
  v_source_job public.jobs%ROWTYPE;
  v_revision public.scene3d_revisions%ROWTYPE;
  v_delivery public.scene3d_deliveries%ROWTYPE;
  v_artifact public.scene3d_artifacts%ROWTYPE;
  v_intent public.scene3d_upload_intents%ROWTYPE;
  v_entry jsonb;
  v_owner uuid;
  v_via uuid;
  v_have jsonb;
  v_wanted jsonb;
BEGIN
  IF v_job_id IS NULL OR v_user_id IS NULL OR v_source_id IS NULL OR v_source_owner IS NULL
     OR v_plan_hash IS NULL OR coalesce(v_kind NOT IN ('retained-revision', 'job-output'), true)
     OR coalesce(v_mode NOT IN ('render-only', 'authored'), true)
     OR jsonb_typeof(v_entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Scene delivery payload is incomplete' USING ERRCODE = '55015';
  END IF;
  SELECT count(*) INTO v_stills FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'shot-still';
  IF jsonb_array_length(v_entries) - v_stills NOT BETWEEN 2 AND 3
     OR jsonb_array_length(v_entries) <> (SELECT count(DISTINCT e->>'artifact_id') FROM jsonb_array_elements(v_entries) e)
     OR (SELECT count(*) FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'poster') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'validation-report') < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_entries) e
       WHERE coalesce(e->>'kind' NOT IN ('poster', 'validation-report', 'shot-still'), true)
          OR (e->>'usage') IS DISTINCT FROM CASE e->>'kind'
                WHEN 'poster' THEN 'poster' WHEN 'shot-still' THEN 'shot-still' ELSE 'validation' END) THEN
    RAISE EXCEPTION 'Scene delivery requires a poster and validation report' USING ERRCODE = '55015';
  END IF;
  -- A still carries its shot identity; nothing else may carry one, and no two
  -- stills of one delivery may claim the same shot or the same frame.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'shot-still'
       AND (jsonb_typeof(e->'shot_index') IS DISTINCT FROM 'number'
         OR jsonb_typeof(e->'frame') IS DISTINCT FROM 'number'
         OR jsonb_typeof(e->'width') IS DISTINCT FROM 'number'
         OR jsonb_typeof(e->'height') IS DISTINCT FROM 'number'
         OR (e->>'shot_index')::numeric < 0 OR (e->>'shot_index')::numeric <> trunc((e->>'shot_index')::numeric)
         OR (e->>'frame')::numeric < 0 OR (e->>'frame')::numeric <> trunc((e->>'frame')::numeric)
         OR (e->>'width')::numeric <= 0 OR (e->>'height')::numeric <= 0))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' <> 'shot-still'
       AND (e->>'shot_index' IS NOT NULL OR e->>'frame' IS NOT NULL
         OR e->>'width' IS NOT NULL OR e->>'height' IS NOT NULL))
     OR v_stills IS DISTINCT FROM (SELECT count(DISTINCT e->>'shot_index')
          FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'shot-still')
     OR v_stills IS DISTINCT FROM (SELECT count(DISTINCT e->>'frame')
          FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'shot-still') THEN
    RAISE EXCEPTION 'Scene delivery shot stills must each name one shot and one frame' USING ERRCODE = '55015';
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;

  -- Serializes concurrent publications and cancellation for this parent.
  SELECT * INTO v_job FROM public.jobs WHERE id = v_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Scene delivery parent is unavailable' USING ERRCODE = '55016';
  END IF;

  SELECT * INTO v_delivery FROM public.scene3d_deliveries WHERE job_id = v_job_id;
  IF FOUND THEN
    IF (v_delivery.user_id, v_delivery.workflow_id, v_delivery.source_kind, v_delivery.source_revision_id,
        v_delivery.source_plan_sha256, v_delivery.source_content_hash, v_delivery.source_owner_id,
        v_delivery.source_workflow_id, v_delivery.mode)
       IS DISTINCT FROM (v_user_id, v_job.workflow_id, v_kind, v_source_id, v_plan_hash, v_content_hash,
                         v_source_owner, v_source_workflow, v_mode) THEN
      RAISE EXCEPTION 'Scene delivery already exists with different content' USING ERRCODE = '55010';
    END IF;
    IF v_delivery.source_job_id IS NOT NULL AND v_delivery.source_job_id IS DISTINCT FROM v_source_job_id THEN
      RAISE EXCEPTION 'Scene delivery source job changed' USING ERRCODE = '55010';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('artifact_id', p.artifact_id, 'artifact_owner_id', p.artifact_owner_id,
      'usage', p.usage, 'via_revision_id', p.via_revision_id, 'kind', a.kind, 'sha256', a.sha256,
      'byte_length', a.byte_length, 'bucket', a.bucket, 'object_key', a.object_key, 'etag', a.etag,
      'shot_index', p.shot_index, 'frame', p.frame, 'width', p.width, 'height', p.height)
      ORDER BY p.artifact_id) INTO v_have
      FROM public.scene3d_delivery_artifacts p JOIN public.scene3d_artifacts a ON a.id = p.artifact_id
      WHERE p.job_id = v_job_id;
    SELECT jsonb_agg(jsonb_build_object('artifact_id', (e->>'artifact_id')::uuid,
      'artifact_owner_id', (e->>'artifact_owner_id')::uuid, 'usage', e->>'usage',
      'via_revision_id', nullif(e->>'via_revision_id', '')::uuid, 'kind', e->>'kind', 'sha256', e->>'sha256',
      'byte_length', (e->>'byte_length')::bigint, 'bucket', e->>'bucket', 'object_key', e->>'object_key', 'etag', e->>'etag',
      'shot_index', (e->>'shot_index')::integer, 'frame', (e->>'frame')::integer,
      'width', (e->>'width')::integer, 'height', (e->>'height')::integer)
      ORDER BY (e->>'artifact_id')::uuid) INTO v_wanted FROM jsonb_array_elements(v_entries) e;
    IF v_have IS DISTINCT FROM v_wanted THEN
      RAISE EXCEPTION 'Scene delivery already exists with different artifacts' USING ERRCODE = '55010';
    END IF;
    RETURN 'unchanged';
  END IF;
  IF v_job.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Scene delivery parent is no longer active' USING ERRCODE = '55016';
  END IF;

  IF v_kind = 'retained-revision' THEN
    SELECT * INTO v_revision FROM public.scene3d_revisions WHERE id = v_source_id FOR SHARE;
    IF NOT FOUND OR (v_revision.user_id, v_revision.workflow_id, v_revision.plan_sha256,
                    v_revision.plan #>> '{provenance,contentHash}')
       IS DISTINCT FROM (v_source_owner, v_source_workflow, v_plan_hash, v_content_hash) THEN
      RAISE EXCEPTION 'Scene delivery source revision changed' USING ERRCODE = '55010';
    END IF;
    IF v_source_job_id IS DISTINCT FROM v_revision.source_job_id
       OR (v_mode = 'authored' AND v_revision.source_job_id IS DISTINCT FROM v_job_id) THEN
      RAISE EXCEPTION 'Scene delivery source job does not match its revision' USING ERRCODE = '55010';
    END IF;
  ELSE
    SELECT * INTO v_source_job FROM public.jobs WHERE id = v_source_job_id FOR SHARE;
    IF NOT FOUND OR v_mode <> 'render-only' OR v_source_job.user_id IS DISTINCT FROM v_user_id
       OR v_source_owner IS DISTINCT FROM v_user_id OR v_source_job.status <> 'completed'
       OR v_source_job.workflow_id IS DISTINCT FROM v_source_workflow
       OR coalesce(v_source_job.output_data #>> '{scenePlan,schemaVersion}', '') <> '1'
       OR (v_source_job.output_data #>> '{scenePlan,revisionId}') IS DISTINCT FROM v_source_id::text
       OR (v_source_job.output_data->'scenePlan') IS DISTINCT FROM (payload->'source_plan') THEN
      RAISE EXCEPTION 'Scene delivery source job is unavailable' USING ERRCODE = '55016';
    END IF;
  END IF;

  INSERT INTO public.scene3d_deliveries(job_id, user_id, workflow_id, source_kind, source_revision_id,
    source_plan_sha256, source_content_hash, source_job_id, source_owner_id, source_workflow_id, mode)
  VALUES (v_job_id, v_user_id, v_job.workflow_id, v_kind, v_source_id, v_plan_hash, v_content_hash,
    v_source_job_id, v_source_owner, v_source_workflow, v_mode);

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_entries) LOOP
    v_owner := (v_entry->>'artifact_owner_id')::uuid;
    v_via := nullif(v_entry->>'via_revision_id', '')::uuid;
    -- A revision never pins a shot still, so there is nothing to reuse from one.
    IF v_via IS NOT NULL AND v_entry->>'kind' = 'shot-still' THEN
      RAISE EXCEPTION 'Scene delivery artifact is not pinned by its source' USING ERRCODE = '55013';
    END IF;
    SELECT * INTO v_artifact FROM public.scene3d_artifacts
      WHERE id = (v_entry->>'artifact_id')::uuid FOR SHARE;
    IF v_via IS NOT NULL THEN
      IF NOT FOUND OR v_kind <> 'retained-revision' OR v_via <> v_source_id OR v_owner <> v_source_owner
         OR NOT EXISTS (SELECT 1 FROM public.scene3d_revision_artifacts p
           WHERE p.revision_id = v_via AND p.artifact_id = v_artifact.id AND p.user_id = v_owner AND p.usage = v_entry->>'usage')
         OR (v_artifact.user_id, v_artifact.kind, v_artifact.sha256, v_artifact.byte_length,
             v_artifact.bucket, v_artifact.object_key, v_artifact.etag)
            IS DISTINCT FROM (v_owner, v_entry->>'kind', v_entry->>'sha256', (v_entry->>'byte_length')::bigint,
                              v_entry->>'bucket', v_entry->>'object_key', v_entry->>'etag') THEN
        RAISE EXCEPTION 'Scene delivery artifact is not pinned by its source' USING ERRCODE = '55013';
      END IF;
    ELSE
      IF FOUND OR v_owner IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'Scene delivery cannot substitute an existing artifact' USING ERRCODE = '55011';
      END IF;
      PERFORM public.scene3d_assert_artifact_id_live((v_entry->>'artifact_id')::uuid,
        v_entry->>'bucket', v_entry->>'object_key');
      SELECT * INTO v_intent FROM public.scene3d_upload_intents
        WHERE artifact_id = (v_entry->>'artifact_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Scene delivery artifact has no reservation' USING ERRCODE = '55018';
      END IF;
      IF (v_intent.user_id, v_intent.job_id, v_intent.revision_id, v_intent.kind, v_intent.bucket, v_intent.object_key)
         IS DISTINCT FROM (v_user_id, v_job_id, v_source_id, v_entry->>'kind', v_entry->>'bucket', v_entry->>'object_key')
         OR (v_intent.receipt_sha256 IS NOT NULL AND
             (v_intent.receipt_sha256, v_intent.receipt_byte_length, v_intent.receipt_etag) IS DISTINCT FROM
             (v_entry->>'sha256', (v_entry->>'byte_length')::bigint, v_entry->>'etag')) THEN
        RAISE EXCEPTION 'Scene delivery artifact reservation does not match' USING ERRCODE = '55017';
      END IF;
      INSERT INTO public.scene3d_artifacts(id, user_id, source_job_id, kind, bucket, object_key, sha256, byte_length, etag)
      VALUES ((v_entry->>'artifact_id')::uuid, v_user_id, v_job_id, v_entry->>'kind', v_entry->>'bucket',
              v_entry->>'object_key', v_entry->>'sha256', (v_entry->>'byte_length')::bigint, v_entry->>'etag');
      DELETE FROM public.scene3d_upload_intents WHERE artifact_id = v_intent.artifact_id;
    END IF;
    INSERT INTO public.scene3d_delivery_artifacts(job_id, artifact_id, artifact_owner_id, usage, via_revision_id,
      shot_index, frame, width, height)
    VALUES (v_job_id, (v_entry->>'artifact_id')::uuid, v_owner, v_entry->>'usage', v_via,
      (v_entry->>'shot_index')::integer, (v_entry->>'frame')::integer,
      (v_entry->>'width')::integer, (v_entry->>'height')::integer);
  END LOOP;
  RETURN 'created';
END;
$$;

REVOKE ALL ON FUNCTION public.scene3d_publish_delivery(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scene3d_publish_delivery(jsonb) TO service_role;
