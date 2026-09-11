-- A 3D Render Pro run whose recipe the compiler never accepted still has evidence.
--
-- `SCENE_QUALITY_FAILED` after an exhausted repair budget comes in two shapes. When some pass
-- BUILT a scene, the run retains that draft: a revision, a poster, the reviewer's findings —
-- migration 390 plus the plugin work behind it. When NO pass ever compiled, there is no plan,
-- so there is no revision and there can be no poster: a v2 manifest requires at least one
-- asset and one shot, and the plan is the compiler's own output. Measured on staging job
-- 9e8b79ee (2026-09-11): output_data empty, no revision, and the deliveries route answering
-- 404 — while the planner's final recipe and the compiler's refusal reasons both existed and
-- were simply dropped on the floor.
--
-- Those two things ARE the evidence such a run produces, so this adds the one delivery shape
-- that can carry them: source kind `refused-authoring`, pinning a validation report and
-- (privately) the retained recipe, with no poster and no published revision behind it.
--
-- It deliberately does NOT touch `scene3d_publish_delivery`. That function settles deliveries
-- that follow paid renders; its poster/plan/revision rules are load-bearing there and a
-- widened branch inside it would relax them for every caller. The refused lane gets its own
-- narrow function with the same structural guards — parent row lock, owner match, active-job
-- requirement, exact-replay comparison — and nothing else in common.

-- `refused-authoring` names a delivery whose source is the PARENT JOB's own refused authoring
-- rather than a scene anyone can open.
ALTER TABLE public.scene3d_deliveries DROP CONSTRAINT IF EXISTS scene3d_deliveries_source_kind_check;
ALTER TABLE public.scene3d_deliveries ADD CONSTRAINT scene3d_deliveries_source_kind_check
  CHECK (source_kind IN ('retained-revision', 'job-output', 'refused-authoring'));

-- No plan, so no plan digest. Every other source kind still supplies one: the two functions
-- that write this table each demand it for their own kinds, so the column stays the exact
-- contract it was for them and merely stops lying about the one that has no plan to hash.
ALTER TABLE public.scene3d_deliveries ALTER COLUMN source_plan_sha256 DROP NOT NULL;
ALTER TABLE public.scene3d_deliveries DROP CONSTRAINT IF EXISTS scene3d_deliveries_refused_has_no_plan;
ALTER TABLE public.scene3d_deliveries ADD CONSTRAINT scene3d_deliveries_refused_has_no_plan
  CHECK ((source_kind = 'refused-authoring') = (source_plan_sha256 IS NULL));

-- The retained recipe is a `source-json` artifact, whose usage is `checkpoint`. It is pinned
-- so retention keeps it (the GC sweep spares anything a delivery pins) and NOT because it
-- becomes readable: `checkpoint` is absent from both user-visible read lanes and from
-- `SCENE3D_DELIVERY_KINDS`, so the delivery routes neither list it nor serve its bytes.
ALTER TABLE public.scene3d_delivery_artifacts DROP CONSTRAINT IF EXISTS scene3d_delivery_artifacts_usage_check;
ALTER TABLE public.scene3d_delivery_artifacts ADD CONSTRAINT scene3d_delivery_artifacts_usage_check
  CHECK (usage IN ('poster', 'validation', 'shot-still', 'checkpoint'));

CREATE OR REPLACE FUNCTION public.scene3d_publish_refused_delivery(payload jsonb)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_job_id uuid := (payload->>'job_id')::uuid;
  v_user_id uuid := (payload->>'user_id')::uuid;
  v_source_id uuid := (payload->>'source_revision_id')::uuid;
  v_entries jsonb := payload->'artifacts';
  v_job public.jobs%ROWTYPE;
  v_delivery public.scene3d_deliveries%ROWTYPE;
  v_artifact public.scene3d_artifacts%ROWTYPE;
  v_intent public.scene3d_upload_intents%ROWTYPE;
  v_entry jsonb;
  v_have jsonb;
  v_wanted jsonb;
BEGIN
  IF v_job_id IS NULL OR v_user_id IS NULL OR v_source_id IS NULL
     OR jsonb_typeof(v_entries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Scene delivery payload is incomplete' USING ERRCODE = '55015';
  END IF;
  -- One report, and at most the recipe beside it. A poster or a still here would be bytes
  -- nothing rendered: this delivery exists precisely because nothing was ever built.
  IF jsonb_array_length(v_entries) NOT BETWEEN 1 AND 2
     OR jsonb_array_length(v_entries) <> (SELECT count(DISTINCT e->>'artifact_id') FROM jsonb_array_elements(v_entries) e)
     OR (SELECT count(*) FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'validation-report') <> 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_entries) e
       WHERE coalesce(e->>'kind' NOT IN ('validation-report', 'source-json'), true)
          OR (e->>'usage') IS DISTINCT FROM CASE e->>'kind'
                WHEN 'validation-report' THEN 'validation' ELSE 'checkpoint' END
          OR e->>'via_revision_id' IS NOT NULL
          OR e->>'shot_index' IS NOT NULL OR e->>'frame' IS NOT NULL
          OR e->>'width' IS NOT NULL OR e->>'height' IS NOT NULL) THEN
    RAISE EXCEPTION 'A refused scene delivery requires its validation report' USING ERRCODE = '55015';
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;

  -- Serializes concurrent publications and cancellation for this parent, exactly as the
  -- paid-delivery function does.
  SELECT * INTO v_job FROM public.jobs WHERE id = v_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Scene delivery parent is unavailable' USING ERRCODE = '55016';
  END IF;

  SELECT * INTO v_delivery FROM public.scene3d_deliveries WHERE job_id = v_job_id;
  IF FOUND THEN
    -- A replay must re-verify the same bytes and adopt. Anything else — including a paid
    -- delivery this job already published — is a conflict, never an overwrite.
    IF (v_delivery.user_id, v_delivery.workflow_id, v_delivery.source_kind, v_delivery.source_revision_id,
        v_delivery.source_plan_sha256, v_delivery.source_content_hash, v_delivery.source_owner_id,
        v_delivery.source_workflow_id, v_delivery.mode, v_delivery.source_job_id)
       IS DISTINCT FROM (v_user_id, v_job.workflow_id, 'refused-authoring', v_source_id,
                         NULL::text, NULL::text, v_user_id, v_job.workflow_id, 'authored', v_job_id) THEN
      RAISE EXCEPTION 'Scene delivery already exists with different content' USING ERRCODE = '55010';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('artifact_id', p.artifact_id, 'artifact_owner_id', p.artifact_owner_id,
      'usage', p.usage, 'kind', a.kind, 'sha256', a.sha256, 'byte_length', a.byte_length,
      'bucket', a.bucket, 'object_key', a.object_key, 'etag', a.etag)
      ORDER BY p.artifact_id) INTO v_have
      FROM public.scene3d_delivery_artifacts p JOIN public.scene3d_artifacts a ON a.id = p.artifact_id
      WHERE p.job_id = v_job_id;
    SELECT jsonb_agg(jsonb_build_object('artifact_id', (e->>'artifact_id')::uuid,
      'artifact_owner_id', (e->>'artifact_owner_id')::uuid, 'usage', e->>'usage', 'kind', e->>'kind',
      'sha256', e->>'sha256', 'byte_length', (e->>'byte_length')::bigint, 'bucket', e->>'bucket',
      'object_key', e->>'object_key', 'etag', e->>'etag')
      ORDER BY (e->>'artifact_id')::uuid) INTO v_wanted FROM jsonb_array_elements(v_entries) e;
    IF v_have IS DISTINCT FROM v_wanted THEN
      RAISE EXCEPTION 'Scene delivery already exists with different artifacts' USING ERRCODE = '55010';
    END IF;
    RETURN 'unchanged';
  END IF;
  -- The ordering property the whole retention design rests on: publication happens while the
  -- parent is still running, BEFORE the row is marked failed. A late worker that lost its
  -- lease and finished after the verdict settled therefore cannot publish anything at all.
  IF v_job.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Scene delivery parent is no longer active' USING ERRCODE = '55016';
  END IF;

  -- The source IS this job: no revision is looked up, because none was ever published. Both
  -- authorization anchors the read path checks therefore resolve to the parent's own owner and
  -- workflow, which is what makes the delivery reachable by exactly the people the job is.
  INSERT INTO public.scene3d_deliveries(job_id, user_id, workflow_id, source_kind, source_revision_id,
    source_plan_sha256, source_content_hash, source_job_id, source_owner_id, source_workflow_id, mode)
  VALUES (v_job_id, v_user_id, v_job.workflow_id, 'refused-authoring', v_source_id,
    NULL, NULL, v_job_id, v_user_id, v_job.workflow_id, 'authored');

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_entries) LOOP
    SELECT * INTO v_artifact FROM public.scene3d_artifacts
      WHERE id = (v_entry->>'artifact_id')::uuid FOR SHARE;
    IF FOUND OR (v_entry->>'artifact_owner_id')::uuid IS DISTINCT FROM v_user_id THEN
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
    INSERT INTO public.scene3d_delivery_artifacts(job_id, artifact_id, artifact_owner_id, usage, via_revision_id)
    VALUES (v_job_id, (v_entry->>'artifact_id')::uuid, v_user_id, v_entry->>'usage', NULL);
  END LOOP;
  RETURN 'created';
END;
$$;

REVOKE ALL ON FUNCTION public.scene3d_publish_refused_delivery(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scene3d_publish_refused_delivery(jsonb) TO service_role;
