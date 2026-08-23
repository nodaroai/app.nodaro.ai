-- Migration 334: Recast audio-layer rescores have two durable rows: the completed Recast
-- parent (the published delivery) and a paid child job (the in-flight work).
-- A read/merge/write checkpoint cannot serialize competing requests and can
-- publish a delivery before a concurrent cancellation wins. These RPCs keep
-- the pending claim and publication inside one database transaction.

-- `jobs` is owner-readable through RLS. The private, pre-watermark remux base
-- therefore cannot live in either jobs JSON column, even if every HTTP route
-- redacts it. Keep the one server-only value in a service-role-only table.
CREATE TABLE IF NOT EXISTS public.recast_audio_bases (
  gvp_job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  base_url text NOT NULL CHECK (length(base_url) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recast_audio_bases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recast_audio_bases FROM PUBLIC;
REVOKE ALL ON TABLE public.recast_audio_bases FROM anon;
REVOKE ALL ON TABLE public.recast_audio_bases FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recast_audio_bases TO service_role;

-- Preserve legacy rescore support while closing the direct-Supabase leak.
INSERT INTO public.recast_audio_bases (gvp_job_id, user_id, base_url)
SELECT id, user_id, output_data->'pro'->>'unscoredUrl'
FROM public.jobs
WHERE user_id IS NOT NULL
  AND jsonb_typeof(output_data->'pro'->'unscoredUrl') = 'string'
  AND coalesce(output_data->'pro'->>'unscoredUrl', '') <> ''
ON CONFLICT (gvp_job_id) DO UPDATE
SET user_id = EXCLUDED.user_id,
    base_url = EXCLUDED.base_url,
    updated_at = now();

UPDATE public.jobs
SET output_data = jsonb_set(
  output_data,
  '{pro}',
  (output_data->'pro') - 'unscoredUrl',
  false
)
WHERE jsonb_typeof(output_data->'pro') = 'object'
  AND output_data->'pro' ? 'unscoredUrl';

-- Early feature-branch builds also snapshotted the base at the child root.
UPDATE public.jobs
SET input_data = input_data - 'unscoredUrl'
WHERE jsonb_typeof(input_data) = 'object' AND input_data ? 'unscoredUrl';

UPDATE public.jobs
SET output_data = output_data - 'unscoredUrl'
WHERE jsonb_typeof(output_data) = 'object' AND output_data ? 'unscoredUrl';

-- Defensive legacy scrub: early development builds and manually replayed jobs
-- may have nested the same exact private field under a wrapper. Recursively
-- remove it before validating the all-depth guard below. The helper lives only
-- in this migration session and is never exposed as a public database API.
CREATE OR REPLACE FUNCTION pg_temp.strip_recast_private_audio_url(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT coalesce(
        jsonb_object_agg(item.key, pg_temp.strip_recast_private_audio_url(item.value)),
        '{}'::jsonb
      )
      INTO v_result
      FROM jsonb_each(p_value) AS item(key, value)
      WHERE item.key <> 'unscoredUrl';
    WHEN 'array' THEN
      SELECT coalesce(
        jsonb_agg(
          pg_temp.strip_recast_private_audio_url(item.value)
          ORDER BY item.ordinality
        ),
        '[]'::jsonb
      )
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS item(value, ordinality);
    ELSE
      v_result := p_value;
  END CASE;
  RETURN v_result;
END;
$$;

UPDATE public.jobs
SET input_data = pg_temp.strip_recast_private_audio_url(input_data)
WHERE jsonb_path_exists(coalesce(input_data, '{}'::jsonb), '$.**.unscoredUrl');

UPDATE public.jobs
SET output_data = pg_temp.strip_recast_private_audio_url(output_data)
WHERE jsonb_path_exists(coalesce(output_data, '{}'::jsonb), '$.**.unscoredUrl');

DROP FUNCTION pg_temp.strip_recast_private_audio_url(jsonb);

-- Make the privacy boundary structural: no future writer can put the field
-- back into owner-readable job JSON at any depth.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass
      AND conname = 'jobs_no_private_recast_audio_url'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_no_private_recast_audio_url CHECK (
        NOT jsonb_path_exists(coalesce(input_data, '{}'::jsonb), '$.**.unscoredUrl')
        AND NOT jsonb_path_exists(coalesce(output_data, '{}'::jsonb), '$.**.unscoredUrl')
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_no_private_recast_audio_url;

-- Workflow deletion normally cascades through jobs and then this private
-- table. Capture the private R2 cleanup manifest in the same transaction so
-- the backend can delete those objects after the durable workflow delete.
-- The table lock closes the only dangerous race: a GVP completion inserting
-- a base after the manifest SELECT but before the workflow cascade. It is held
-- for this short transaction only and workflow deletion is rare.
CREATE OR REPLACE FUNCTION public.delete_workflow_with_recast_cleanup(
  p_workflow_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_workflow_id uuid;
  v_base_urls jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_workflow_id
  FROM public.workflows
  WHERE id = p_workflow_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'baseUrls', v_base_urls);
  END IF;

  LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE;

  SELECT coalesce(jsonb_agg(base_url ORDER BY base_url), '[]'::jsonb)
  INTO v_base_urls
  FROM (
    SELECT DISTINCT private_base.base_url
    FROM public.recast_audio_bases AS private_base
    JOIN public.jobs AS gvp_job ON gvp_job.id = private_base.gvp_job_id
    WHERE gvp_job.workflow_id = p_workflow_id
      AND gvp_job.user_id = p_user_id
      AND private_base.user_id = p_user_id
  ) AS owned_bases;

  DELETE FROM public.workflows
  WHERE id = v_workflow_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow delete lost its owner-scoped row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls);
END;
$$;

-- Deleting a non-default project cascades through all of its workflows. Keep
-- the same private-object cleanup guarantee for that official deletion path.
CREATE OR REPLACE FUNCTION public.delete_project_with_recast_cleanup(
  p_project_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_base_urls jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_project_id
  FROM public.projects
  WHERE id = p_project_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'baseUrls', v_base_urls);
  END IF;

  LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE;

  SELECT coalesce(jsonb_agg(base_url ORDER BY base_url), '[]'::jsonb)
  INTO v_base_urls
  FROM (
    SELECT DISTINCT private_base.base_url
    FROM public.recast_audio_bases AS private_base
    JOIN public.jobs AS gvp_job ON gvp_job.id = private_base.gvp_job_id
    JOIN public.workflows AS workflow ON workflow.id = gvp_job.workflow_id
    WHERE workflow.project_id = p_project_id
      AND workflow.user_id = p_user_id
      AND gvp_job.user_id = p_user_id
      AND private_base.user_id = p_user_id
  ) AS owned_bases;

  DELETE FROM public.projects
  WHERE id = v_project_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project delete lost its owner-scoped row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls);
END;
$$;

-- The job-history delete route can target a GVP job directly, or a parent job
-- whose children cascade. Capture every private base in that subtree before
-- deleting it. The explicit admin bit is trusted only because this RPC is
-- service-role-only and the authenticated route derives it from server auth.
CREATE OR REPLACE FUNCTION public.delete_job_with_recast_cleanup(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_is_admin boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_id uuid;
  v_base_urls jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_job_id
  FROM public.jobs
  WHERE id = p_job_id AND (p_is_admin OR user_id = p_actor_user_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'baseUrls', v_base_urls);
  END IF;

  LOCK TABLE public.recast_audio_bases IN SHARE ROW EXCLUSIVE MODE;

  WITH RECURSIVE deleting_jobs(id) AS (
    SELECT v_job_id
    -- UNION deduplicates defensively if historic/corrupt parent links contain
    -- a cycle; deletion must terminate even when the tree invariant did not.
    UNION
    SELECT child.id
    FROM public.jobs AS child
    JOIN deleting_jobs ON child.parent_job_id = deleting_jobs.id
  )
  SELECT coalesce(jsonb_agg(base_url ORDER BY base_url), '[]'::jsonb)
  INTO v_base_urls
  FROM (
    SELECT DISTINCT private_base.base_url
    FROM public.recast_audio_bases AS private_base
    JOIN deleting_jobs ON deleting_jobs.id = private_base.gvp_job_id
  ) AS owned_bases;

  DELETE FROM public.jobs
  WHERE id = v_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job delete lost its authorized row';
  END IF;

  RETURN jsonb_build_object('deleted', true, 'baseUrls', v_base_urls);
END;
$$;

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
  v_private_base text;
  v_pending_job_id uuid;
  v_pending_status text;
  v_pending_recast_id text;
  v_pending_gvp_job_id text;
BEGIN
  -- Parent-first is the lock order shared with publish. Concurrent claims
  -- serialize here and re-evaluate against the winner's committed manifest.
  SELECT * INTO v_parent
  FROM public.jobs
  WHERE id = p_recast_id
  FOR UPDATE;

  IF NOT FOUND OR v_parent.user_id IS DISTINCT FROM p_user_id
     OR v_parent.status IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_parent.output_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'run_changed');
  END IF;

  SELECT * INTO v_gvp
  FROM public.jobs
  WHERE id = p_gvp_job_id
  FOR SHARE;
  IF NOT FOUND OR v_gvp.user_id IS DISTINCT FROM p_user_id
     OR v_gvp.status IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'run_unavailable');
  END IF;

  SELECT base_url INTO v_private_base
  FROM public.recast_audio_bases
  WHERE gvp_job_id = p_gvp_job_id AND user_id = p_user_id;
  IF NOT FOUND OR coalesce(v_private_base, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rescore_unavailable');
  END IF;

  -- The parent may still carry the previous take after Continue retargets it
  -- to a newer GVP job. Start from the selected GVP's immutable manifest and
  -- use parent audio only when its terminal rescore lineage, or its live
  -- pending child, proves that it belongs to this exact selected run.
  v_audio := v_gvp.output_data->'pro'->'audio';
  IF v_parent.output_data->'rescore'->>'gvpJobId' = p_gvp_job_id::text
     AND jsonb_typeof(v_parent.output_data->'audio') = 'object' THEN
    v_audio := v_parent.output_data->'audio';
  ELSE
    BEGIN
      v_pending_job_id := nullif(
        v_parent.output_data->'audio'->'pendingRescore'->>'jobId',
        ''
      )::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_pending_job_id := NULL;
    END;
    IF v_pending_job_id IS NOT NULL THEN
      SELECT status, input_data->>'recastId', input_data->>'gvpJobId'
      INTO v_pending_status, v_pending_recast_id, v_pending_gvp_job_id
      FROM public.jobs
      WHERE id = v_pending_job_id AND user_id = p_user_id;
      IF v_pending_status IN ('pending', 'queued', 'processing')
         AND v_pending_recast_id IS NOT DISTINCT FROM p_recast_id::text
         AND v_pending_gvp_job_id IS NOT DISTINCT FROM p_gvp_job_id::text THEN
        v_audio := v_parent.output_data->'audio';
      END IF;
    END IF;
  END IF;
  IF v_audio IS NULL OR jsonb_typeof(v_audio) <> 'object'
     OR jsonb_typeof(v_audio->'version') IS DISTINCT FROM 'number'
     OR v_audio->'version' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(v_audio->'revision') IS DISTINCT FROM 'string'
     OR coalesce(v_audio->>'revision', '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'audio_layers_unavailable');
  END IF;

  -- A durable pending stamp is active only while its child is live. A missing
  -- or terminal child, or one from a superseded selected run, is repaired
  -- under the same parent lock before claiming.
  v_pending_job_id := NULL;
  v_pending_status := NULL;
  v_pending_recast_id := NULL;
  v_pending_gvp_job_id := NULL;
  BEGIN
    v_pending_job_id := nullif(v_audio->'pendingRescore'->>'jobId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_pending_job_id := NULL;
  END;
  IF v_pending_job_id IS NOT NULL THEN
    SELECT status, input_data->>'recastId', input_data->>'gvpJobId'
    INTO v_pending_status, v_pending_recast_id, v_pending_gvp_job_id
    FROM public.jobs
    WHERE id = v_pending_job_id AND user_id = p_user_id;
    IF v_pending_status IN ('pending', 'queued', 'processing')
       AND v_pending_recast_id IS NOT DISTINCT FROM p_recast_id::text
       AND v_pending_gvp_job_id IS NOT DISTINCT FROM p_gvp_job_id::text
       AND v_pending_job_id <> p_child_job_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'rescore_in_progress',
        'activeJobId', v_pending_job_id,
        'audioRevision', v_audio->>'revision'
      );
    ELSIF v_pending_status IS NULL
       OR v_pending_status NOT IN ('pending', 'queued', 'processing')
       OR v_pending_recast_id IS DISTINCT FROM p_recast_id::text
       OR v_pending_gvp_job_id IS DISTINCT FROM p_gvp_job_id::text THEN
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
  WHERE id = p_child_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_child.user_id IS DISTINCT FROM p_user_id
     OR coalesce(v_child.status, '') NOT IN ('pending', 'queued', 'processing')
     OR jsonb_typeof(v_child.input_data) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_child.input_data->'recastId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_child.input_data->'gvpJobId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_child.input_data->'requestId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_child.input_data->'expectedAudioRevision') IS DISTINCT FROM 'string'
     OR v_child.input_data->>'recastId' IS DISTINCT FROM p_recast_id::text
     OR v_child.input_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text
     OR v_child.input_data->>'expectedAudioRevision' IS DISTINCT FROM p_expected_audio_revision THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'child_not_live');
  END IF;

  IF jsonb_typeof(p_pending_rescore) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_pending_rescore->'jobId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_pending_rescore->'requestId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_pending_rescore->'state') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_pending_rescore->'expectedAudioRevision') IS DISTINCT FROM 'string'
     OR p_pending_rescore->>'jobId' IS DISTINCT FROM p_child_job_id::text
     OR v_child.input_data->>'requestId' IS DISTINCT FROM p_pending_rescore->>'requestId'
     OR p_pending_rescore->>'expectedAudioRevision' IS DISTINCT FROM p_expected_audio_revision
     OR coalesce(p_pending_rescore->>'state', '') NOT IN ('pending', 'running')
     OR coalesce(p_pending_rescore->>'requestId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_pending_rescore->'requestedEffectiveGain') IS DISTINCT FROM 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_pending_rescore) AS key
       WHERE key NOT IN ('jobId', 'requestId', 'state', 'expectedAudioRevision', 'requestedEffectiveGain')
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_each(p_pending_rescore->'requestedEffectiveGain') AS gain(gain_key, gain_value)
       WHERE gain_key NOT IN ('music', 'video')
          OR CASE
            WHEN jsonb_typeof(gain_value) <> 'number' THEN true
            ELSE (gain_value #>> '{}')::numeric < 0
              OR (gain_value #>> '{}')::numeric > 200
              OR mod((gain_value #>> '{}')::numeric, 1) <> 0
          END
     )
     OR jsonb_path_exists(p_pending_rescore, '$.**.unscoredUrl') THEN
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

-- Old clients do not carry an audio revision/claim, but their publication
-- still must not expose the parent write before a concurrent child cancel.
-- Keep their established ffmpeg/request contract and atomically move only the
-- terminal database boundary.
CREATE OR REPLACE FUNCTION public.publish_legacy_recast_rescore(
  p_recast_id uuid,
  p_child_job_id uuid,
  p_user_id uuid,
  p_gvp_job_id uuid,
  p_result_url text,
  p_rescore jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent public.jobs%ROWTYPE;
  v_gvp public.jobs%ROWTYPE;
  v_child public.jobs%ROWTYPE;
  v_private_base text;
  v_updated integer;
BEGIN
  SELECT * INTO v_parent
  FROM public.jobs
  WHERE id = p_recast_id
  FOR UPDATE;
  IF NOT FOUND OR v_parent.user_id IS DISTINCT FROM p_user_id
     OR v_parent.status IS DISTINCT FROM 'completed'
     OR v_parent.output_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RETURN false;
  END IF;

  SELECT * INTO v_gvp
  FROM public.jobs
  WHERE id = p_gvp_job_id
  FOR SHARE;
  IF NOT FOUND OR v_gvp.user_id IS DISTINCT FROM p_user_id
     OR v_gvp.status IS DISTINCT FROM 'completed' THEN
    RETURN false;
  END IF;

  SELECT base_url INTO v_private_base
  FROM public.recast_audio_bases
  WHERE gvp_job_id = p_gvp_job_id AND user_id = p_user_id;
  IF NOT FOUND OR coalesce(v_private_base, '') = '' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_child
  FROM public.jobs
  WHERE id = p_child_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_child.user_id IS DISTINCT FROM p_user_id
     OR jsonb_typeof(v_child.input_data) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_child.input_data->'recastId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_child.input_data->'gvpJobId') IS DISTINCT FROM 'string'
     OR v_child.input_data->>'recastId' IS DISTINCT FROM p_recast_id::text
     OR v_child.input_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_rescore) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_rescore->'videoUrl') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_rescore->'gvpJobId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_rescore->'at') IS DISTINCT FROM 'string'
     OR p_rescore->>'videoUrl' IS DISTINCT FROM p_result_url
     OR p_rescore->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text
     OR coalesce(p_result_url, '') = ''
     OR split_part(split_part(p_result_url, '?', 1), '#', 1)
       IS NOT DISTINCT FROM split_part(split_part(v_private_base, '?', 1), '#', 1)
     OR jsonb_path_exists(p_rescore, '$.**.unscoredUrl')
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_rescore) AS key
       WHERE key NOT IN ('videoUrl', 'gvpJobId', 'tracks', 'audioUrl', 'at')
     )
     OR (p_rescore ? 'audioUrl' AND (
       jsonb_typeof(p_rescore->'audioUrl') IS DISTINCT FROM 'string'
       OR coalesce(p_rescore->>'audioUrl', '') = ''
       OR split_part(split_part(p_rescore->>'audioUrl', '?', 1), '#', 1)
         IS NOT DISTINCT FROM split_part(split_part(v_private_base, '?', 1), '#', 1)
     ))
     OR (p_rescore ? 'tracks' AND jsonb_typeof(p_rescore->'tracks') IS DISTINCT FROM 'array')
     OR (CASE
       WHEN jsonb_typeof(p_rescore->'tracks') = 'array' THEN EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_rescore->'tracks') AS track(value)
         WHERE CASE
           WHEN jsonb_typeof(value) IS DISTINCT FROM 'object' THEN true
           WHEN jsonb_typeof(value->'offsetSec') IS DISTINCT FROM 'number'
             OR jsonb_typeof(value->'durationSec') IS DISTINCT FROM 'number'
             OR jsonb_typeof(value->'url') IS DISTINCT FROM 'string' THEN true
           ELSE coalesce(value->>'url', '') = ''
             OR (value #>> '{offsetSec}')::numeric < 0
             OR (value #>> '{durationSec}')::numeric <= 0
             OR split_part(split_part(value->>'url', '?', 1), '#', 1)
               IS NOT DISTINCT FROM split_part(split_part(v_private_base, '?', 1), '#', 1)
             OR EXISTS (
               SELECT 1 FROM jsonb_object_keys(value) AS track_key
               WHERE track_key NOT IN ('offsetSec', 'durationSec', 'url', 'brief', 'origin')
             )
             OR (value ? 'brief' AND jsonb_typeof(value->'brief') IS DISTINCT FROM 'string')
             OR (value ? 'origin' AND (
               jsonb_typeof(value->'origin') IS DISTINCT FROM 'string'
               OR value->>'origin' NOT IN ('original', 'own', 'generated')
             ))
         END
       )
       ELSE false
     END) THEN
    RAISE EXCEPTION 'invalid legacy Recast audio publication';
  END IF;

  -- PostgREST can lose the response after this transaction commits. An exact
  -- retry is success only when both durable rows already contain this exact
  -- publication; every different terminal child remains a CAS loss.
  IF v_child.status = 'completed' THEN
    RETURN v_parent.output_data->'rescore' IS NOT DISTINCT FROM p_rescore
      AND v_child.output_data->>'videoUrl' IS NOT DISTINCT FROM p_result_url
      AND v_child.output_data->>'recastId' IS NOT DISTINCT FROM p_recast_id::text;
  END IF;
  IF coalesce(v_child.status, '') NOT IN ('pending', 'queued', 'processing') THEN
    RETURN false;
  END IF;

  UPDATE public.jobs
  SET output_data = coalesce(output_data, '{}'::jsonb)
    || jsonb_build_object('rescore', p_rescore)
  WHERE id = p_recast_id;

  UPDATE public.jobs
  SET status = 'completed',
      progress = 100,
      output_data = coalesce(output_data, '{}'::jsonb) || jsonb_build_object(
        'videoUrl', p_result_url,
        'recastId', p_recast_id
      ),
      error_message = NULL,
      completed_at = now()
  WHERE id = p_child_job_id
    AND status IN ('pending', 'queued', 'processing');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'legacy Recast rescore child lost its completion CAS';
  END IF;

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
  v_gvp public.jobs%ROWTYPE;
  v_child public.jobs%ROWTYPE;
  v_current_audio jsonb;
  v_private_base text;
  v_present_keys text[];
  v_baked_keys text[];
  v_layer_keys text[];
  v_updated integer;
BEGIN
  SELECT * INTO v_parent
  FROM public.jobs
  WHERE id = p_recast_id
  FOR UPDATE;
  IF NOT FOUND OR v_parent.user_id IS DISTINCT FROM p_user_id
     OR v_parent.status IS DISTINCT FROM 'completed'
     OR v_parent.output_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text THEN
    RETURN false;
  END IF;

  SELECT * INTO v_gvp
  FROM public.jobs
  WHERE id = p_gvp_job_id
  FOR SHARE;
  IF NOT FOUND OR v_gvp.user_id IS DISTINCT FROM p_user_id
     OR v_gvp.status IS DISTINCT FROM 'completed' THEN
    RETURN false;
  END IF;

  SELECT base_url INTO v_private_base
  FROM public.recast_audio_bases
  WHERE gvp_job_id = p_gvp_job_id AND user_id = p_user_id;
  IF NOT FOUND OR coalesce(v_private_base, '') = '' THEN
    RETURN false;
  END IF;

  -- Lock the child after the parent. A cancellation that won first is
  -- observed as terminal; one arriving later waits for this transaction.
  SELECT * INTO v_child
  FROM public.jobs
  WHERE id = p_child_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_child.user_id IS DISTINCT FROM p_user_id
     OR jsonb_typeof(v_child.input_data) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_child.input_data->'recastId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_child.input_data->'gvpJobId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_child.input_data->'requestId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_child.input_data->'expectedAudioRevision') IS DISTINCT FROM 'string'
     OR v_child.input_data->>'recastId' IS DISTINCT FROM p_recast_id::text
     OR v_child.input_data->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text
     OR v_child.input_data->>'expectedAudioRevision' IS DISTINCT FROM p_expected_audio_revision THEN
    RETURN false;
  END IF;

  -- Exact retries close the transaction-response ambiguity. The freshly
  -- published manifest no longer has the expected OLD revision or pending
  -- stamp, so recognize the complete two-row result before those normal CAS
  -- predicates below.
  IF v_child.status = 'completed' THEN
    RETURN v_parent.output_data->'audio' IS NOT DISTINCT FROM p_audio
      AND v_parent.output_data->'rescore' IS NOT DISTINCT FROM p_rescore
      AND v_child.output_data->>'videoUrl' IS NOT DISTINCT FROM p_result_url
      AND v_child.output_data->>'recastId' IS NOT DISTINCT FROM p_recast_id::text
      AND v_child.output_data->'audio' IS NOT DISTINCT FROM p_audio;
  END IF;
  IF coalesce(v_child.status, '') NOT IN ('pending', 'queued', 'processing') THEN
    RETURN false;
  END IF;

  v_current_audio := v_parent.output_data->'audio';
  IF v_current_audio->>'revision' IS DISTINCT FROM p_expected_audio_revision
     OR v_current_audio->'pendingRescore'->>'jobId' IS DISTINCT FROM p_child_job_id::text THEN
    RETURN false;
  END IF;

  -- The database is the final guard against publishing a malformed manifest
  -- or accidentally projecting the private unscored-video field.
  IF jsonb_typeof(p_audio) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_audio->'version') IS DISTINCT FROM 'number'
     OR p_audio->'version' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(p_audio->'revision') IS DISTINCT FROM 'string'
     OR coalesce(p_audio->>'revision', '') = ''
     OR p_audio->>'revision' = p_expected_audio_revision
     OR jsonb_typeof(p_audio->'mode') IS DISTINCT FROM 'string'
     OR coalesce(p_audio->>'mode', '') NOT IN ('bed', 'replace')
     OR p_audio->>'mode' IS DISTINCT FROM v_current_audio->>'mode'
     OR jsonb_typeof(p_audio->'present') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_audio->'layers') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_audio->'bakedEffectiveGain') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_rescore) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_rescore->'videoUrl') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_rescore->'gvpJobId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_rescore->'tracks') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_rescore->'at') IS DISTINCT FROM 'string'
     OR p_audio ? 'pendingRescore'
     OR jsonb_path_exists(p_audio, '$.**.unscoredUrl')
     OR jsonb_path_exists(p_rescore, '$.**.unscoredUrl')
     OR coalesce(p_result_url, '') = ''
     OR split_part(split_part(p_result_url, '?', 1), '#', 1)
       IS NOT DISTINCT FROM split_part(
         split_part(v_private_base, '?', 1),
         '#',
         1
       )
     OR p_rescore->>'videoUrl' IS DISTINCT FROM p_result_url
     OR p_rescore->>'gvpJobId' IS DISTINCT FROM p_gvp_job_id::text
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_rescore) AS key
       WHERE key NOT IN ('videoUrl', 'gvpJobId', 'tracks', 'preparedMusicUrl', 'audioUrl', 'at')
     )
     OR (p_rescore ? 'preparedMusicUrl' AND (
       jsonb_typeof(p_rescore->'preparedMusicUrl') IS DISTINCT FROM 'string'
       OR coalesce(p_rescore->>'preparedMusicUrl', '') = ''
       OR split_part(split_part(p_rescore->>'preparedMusicUrl', '?', 1), '#', 1)
         IS NOT DISTINCT FROM split_part(split_part(v_private_base, '?', 1), '#', 1)
     ))
     OR (p_rescore ? 'audioUrl' AND (
       jsonb_typeof(p_rescore->'audioUrl') IS DISTINCT FROM 'string'
       OR coalesce(p_rescore->>'audioUrl', '') = ''
       OR split_part(split_part(p_rescore->>'audioUrl', '?', 1), '#', 1)
         IS NOT DISTINCT FROM split_part(split_part(v_private_base, '?', 1), '#', 1)
     )) THEN
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
     OR p_audio->'bakedEffectiveGain' IS DISTINCT FROM v_current_audio->'pendingRescore'->'requestedEffectiveGain'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_audio) AS key
       WHERE key NOT IN ('version', 'revision', 'mode', 'present', 'layers', 'bakedEffectiveGain')
     )
     OR (p_audio->>'mode' = 'replace' AND p_audio->'present' ? 'video')
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_audio->'present')
       WHERE value <> 'true'::jsonb
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_audio->'layers')
       WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR jsonb_typeof(value->'url') IS DISTINCT FROM 'string'
         OR coalesce(value->>'url', '') = ''
         OR value ? 'unscoredUrl'
         OR split_part(split_part(value->>'url', '?', 1), '#', 1)
           IS NOT DISTINCT FROM split_part(
             split_part(v_private_base, '?', 1),
             '#',
             1
           )
         OR CASE
           WHEN jsonb_typeof(value) = 'object' THEN EXISTS (
             SELECT 1 FROM jsonb_object_keys(value) AS layer_key
             WHERE layer_key <> 'url'
           )
           ELSE false
         END
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

  IF (p_rescore ? 'preparedMusicUrl') IS DISTINCT FROM (p_audio->'layers' ? 'music')
     OR (
       p_rescore ? 'preparedMusicUrl'
       AND p_rescore->>'preparedMusicUrl' IS DISTINCT FROM p_audio->'layers'->'music'->>'url'
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_rescore->'tracks') AS track(value)
       WHERE CASE
         WHEN jsonb_typeof(value) IS DISTINCT FROM 'object' THEN true
         WHEN jsonb_typeof(value->'offsetSec') IS DISTINCT FROM 'number'
           OR jsonb_typeof(value->'durationSec') IS DISTINCT FROM 'number'
           OR jsonb_typeof(value->'url') IS DISTINCT FROM 'string' THEN true
         ELSE coalesce(value->>'url', '') = ''
           OR (value #>> '{offsetSec}')::numeric < 0
           OR (value #>> '{durationSec}')::numeric <= 0
           OR split_part(split_part(value->>'url', '?', 1), '#', 1)
             IS NOT DISTINCT FROM split_part(split_part(v_private_base, '?', 1), '#', 1)
           OR EXISTS (
             SELECT 1 FROM jsonb_object_keys(value) AS track_key
             WHERE track_key NOT IN ('offsetSec', 'durationSec', 'url', 'brief', 'origin')
           )
           OR (value ? 'brief' AND jsonb_typeof(value->'brief') IS DISTINCT FROM 'string')
           OR (value ? 'origin' AND (
             jsonb_typeof(value->'origin') IS DISTINCT FROM 'string'
             OR value->>'origin' NOT IN ('original', 'own', 'generated')
           ))
       END
     ) THEN
    RAISE EXCEPTION 'invalid Recast audio provenance invariants';
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
REVOKE EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workflow_with_recast_cleanup(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_with_recast_cleanup(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_job_with_recast_cleanup(uuid, uuid, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_recast_rescore_claim(uuid, uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.publish_legacy_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.publish_legacy_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_legacy_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_legacy_recast_rescore(uuid, uuid, uuid, uuid, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_recast_rescore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) TO service_role;
