-- Recast audio-layer rescores have two durable rows: the completed Recast
-- parent (the published delivery) and a paid child job (the in-flight work).
-- A read/merge/write checkpoint cannot serialize competing requests and can
-- publish a delivery before a concurrent cancellation wins. These RPCs keep
-- the pending claim and publication inside one database transaction.

CREATE OR REPLACE FUNCTION public.claim_recast_rescore(
  p_recast_id uuid,
  p_child_job_id uuid,
  p_user_id uuid,
  p_gvp_job_id uuid,
  p_expected_audio_revision text,
  p_pending_rescore jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent public.jobs%ROWTYPE;
  v_gvp public.jobs%ROWTYPE;
  v_child public.jobs%ROWTYPE;
  v_audio jsonb;
  v_pending_job_id uuid;
  v_pending_status text;
BEGIN
  -- Parent-first is the lock order shared with publish. Concurrent claims
  -- serialize here and re-evaluate against the winner's committed manifest.
  SELECT * INTO v_parent
  FROM public.jobs
  WHERE id = p_recast_id
  FOR UPDATE;

  IF NOT FOUND OR v_parent.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_parent.output_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'run_changed');
  END IF;

  SELECT * INTO v_gvp
  FROM public.jobs
  WHERE id = p_gvp_job_id;
  IF NOT FOUND OR v_gvp.user_id <> p_user_id OR v_gvp.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'run_unavailable');
  END IF;

  v_audio := v_parent.output_data->'audio';
  IF v_audio IS NULL THEN
    v_audio := v_gvp.output_data->'pro'->'audio';
  END IF;
  IF v_audio IS NULL OR jsonb_typeof(v_audio) <> 'object'
     OR v_audio->>'version' <> '1'
     OR coalesce(v_audio->>'revision', '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'audio_layers_unavailable');
  END IF;

  -- A durable pending stamp is active only while its child is live. A missing
  -- or terminal child is repaired under the same parent lock before claiming.
  BEGIN
    v_pending_job_id := nullif(v_audio->'pendingRescore'->>'jobId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_pending_job_id := NULL;
  END;
  IF v_pending_job_id IS NOT NULL THEN
    SELECT status INTO v_pending_status
    FROM public.jobs
    WHERE id = v_pending_job_id AND user_id = p_user_id;
    IF v_pending_status IN ('pending', 'queued', 'processing')
       AND v_pending_job_id <> p_child_job_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'rescore_in_progress',
        'activeJobId', v_pending_job_id,
        'audioRevision', v_audio->>'revision'
      );
    ELSIF v_pending_status IS NULL
       OR v_pending_status NOT IN ('pending', 'queued', 'processing') THEN
      v_audio := v_audio - 'pendingRescore';
    END IF;
  END IF;

  IF v_audio->>'revision' <> p_expected_audio_revision THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'stale_audio_revision',
      'audioRevision', v_audio->>'revision'
    );
  END IF;

  SELECT * INTO v_child
  FROM public.jobs
  WHERE id = p_child_job_id;
  IF NOT FOUND OR v_child.user_id <> p_user_id
     OR v_child.status NOT IN ('pending', 'queued', 'processing')
     OR v_child.input_data->>'recastId' IS DISTINCT FROM p_recast_id::text
     OR v_child.input_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'child_not_live');
  END IF;

  IF jsonb_typeof(p_pending_rescore) <> 'object'
     OR p_pending_rescore->>'jobId' IS DISTINCT FROM p_child_job_id::text
     OR p_pending_rescore->>'expectedAudioRevision' IS DISTINCT FROM p_expected_audio_revision
     OR p_pending_rescore->>'state' NOT IN ('pending', 'running')
     OR coalesce(p_pending_rescore->>'requestId', '') = ''
     OR jsonb_typeof(p_pending_rescore->'requestedEffectiveGain') <> 'object' THEN
    RAISE EXCEPTION 'invalid Recast pending-rescore payload';
  END IF;

  v_audio := (v_audio - 'pendingRescore')
    || jsonb_build_object('pendingRescore', p_pending_rescore);
  UPDATE public.jobs
  SET output_data = coalesce(output_data, '{}'::jsonb)
    || jsonb_build_object('audio', v_audio)
  WHERE id = p_recast_id;

  RETURN jsonb_build_object('ok', true, 'audio', v_audio);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_recast_rescore_claim(
  p_recast_id uuid,
  p_child_job_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_audio jsonb;
BEGIN
  SELECT output_data->'audio' INTO v_audio
  FROM public.jobs
  WHERE id = p_recast_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_audio->'pendingRescore'->>'jobId' IS DISTINCT FROM p_child_job_id::text THEN
    RETURN false;
  END IF;

  UPDATE public.jobs
  SET output_data = jsonb_set(output_data, '{audio}', v_audio - 'pendingRescore')
  WHERE id = p_recast_id AND user_id = p_user_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_recast_rescore(
  p_recast_id uuid,
  p_child_job_id uuid,
  p_user_id uuid,
  p_gvp_job_id uuid,
  p_expected_audio_revision text,
  p_result_url text,
  p_audio jsonb,
  p_rescore jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent public.jobs%ROWTYPE;
  v_child public.jobs%ROWTYPE;
  v_current_audio jsonb;
  v_present_keys text[];
  v_baked_keys text[];
  v_layer_keys text[];
  v_updated integer;
BEGIN
  SELECT * INTO v_parent
  FROM public.jobs
  WHERE id = p_recast_id
  FOR UPDATE;
  IF NOT FOUND OR v_parent.user_id <> p_user_id
     OR v_parent.output_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RETURN false;
  END IF;

  -- Lock the child after the parent. A cancellation that won first is
  -- observed as terminal; one arriving later waits for this transaction.
  SELECT * INTO v_child
  FROM public.jobs
  WHERE id = p_child_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_child.user_id <> p_user_id
     OR v_child.status NOT IN ('pending', 'queued', 'processing')
     OR v_child.input_data->>'recastId' IS DISTINCT FROM p_recast_id::text
     OR v_child.input_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text
     OR v_child.input_data->>'expectedAudioRevision' IS DISTINCT FROM p_expected_audio_revision THEN
    RETURN false;
  END IF;

  v_current_audio := v_parent.output_data->'audio';
  IF v_current_audio->>'revision' IS DISTINCT FROM p_expected_audio_revision
     OR v_current_audio->'pendingRescore'->>'jobId' IS DISTINCT FROM p_child_job_id::text THEN
    RETURN false;
  END IF;

  -- The database is the final guard against publishing a malformed manifest
  -- or accidentally projecting the private unscored-video field.
  IF jsonb_typeof(p_audio) <> 'object'
     OR p_audio->>'version' <> '1'
     OR coalesce(p_audio->>'revision', '') = ''
     OR p_audio->>'revision' = p_expected_audio_revision
     OR p_audio->>'mode' NOT IN ('bed', 'replace')
     OR jsonb_typeof(p_audio->'present') <> 'object'
     OR jsonb_typeof(p_audio->'layers') <> 'object'
     OR jsonb_typeof(p_audio->'bakedEffectiveGain') <> 'object'
     OR p_audio ? 'pendingRescore'
     OR p_audio ? 'unscoredUrl'
     OR p_rescore ? 'unscoredUrl'
     OR coalesce(p_result_url, '') = ''
     OR p_rescore->>'videoUrl' IS DISTINCT FROM p_result_url
     OR p_rescore->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RAISE EXCEPTION 'invalid Recast audio publication';
  END IF;

  SELECT coalesce(array_agg(key ORDER BY key), '{}'::text[])
  INTO v_present_keys FROM jsonb_object_keys(p_audio->'present') AS key;
  SELECT coalesce(array_agg(key ORDER BY key), '{}'::text[])
  INTO v_baked_keys FROM jsonb_object_keys(p_audio->'bakedEffectiveGain') AS key;
  SELECT coalesce(array_agg(key ORDER BY key), '{}'::text[])
  INTO v_layer_keys FROM jsonb_object_keys(p_audio->'layers') AS key;

  IF NOT (v_present_keys <@ ARRAY['music', 'video']::text[])
     OR v_present_keys <> v_baked_keys
     OR NOT (v_layer_keys <@ v_present_keys)
     OR (p_audio->>'mode' = 'replace' AND p_audio->'present' ? 'video')
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_audio->'present')
       WHERE value <> 'true'::jsonb
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_audio->'layers')
       WHERE jsonb_typeof(value) <> 'object'
          OR coalesce(value->>'url', '') = ''
          OR value ? 'unscoredUrl'
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_audio->'bakedEffectiveGain')
       WHERE CASE
         WHEN jsonb_typeof(value) <> 'number' THEN true
         ELSE (value #>> '{}')::numeric < 0
           OR (value #>> '{}')::numeric > 200
           OR mod((value #>> '{}')::numeric, 1) <> 0
       END
     ) THEN
    RAISE EXCEPTION 'invalid Recast audio manifest invariants';
  END IF;

  UPDATE public.jobs
  SET output_data = coalesce(output_data, '{}'::jsonb)
    || jsonb_build_object('rescore', p_rescore, 'audio', p_audio)
  WHERE id = p_recast_id;

  UPDATE public.jobs
  SET status = 'completed',
      progress = 100,
      output_data = coalesce(output_data, '{}'::jsonb) || jsonb_build_object(
        'videoUrl', p_result_url,
        'recastId', p_recast_id,
        'audio', p_audio
      ),
      error_message = NULL,
      completed_at = now()
  WHERE id = p_child_job_id
    AND status IN ('pending', 'queued', 'processing');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    -- Defensive rollback: returning false here would commit the parent UPDATE.
    RAISE EXCEPTION 'Recast rescore child lost its completion CAS';
  END IF;

  RETURN true;
END;
$$;

-- Backend service role only. Browser clients must never claim or publish a
-- rescore by calling PostgREST directly.
REVOKE EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) TO service_role;
