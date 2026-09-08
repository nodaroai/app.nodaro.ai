-- Export evidence belongs to the render job, without modifying its source scene.
CREATE TABLE IF NOT EXISTS public.scene3d_deliveries (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('retained-revision', 'job-output')),
  source_revision_id uuid NOT NULL,
  source_plan_sha256 text NOT NULL CHECK (source_plan_sha256 ~ '^[a-f0-9]{64}$'),
  source_content_hash text CHECK (source_content_hash ~ '^[a-f0-9]{64}$'),
  source_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  -- Preserve the authorization anchor even if the source revision is deleted.
  -- The API checks BOTH workflow scopes on every delivery read.
  source_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('render-only', 'authored')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scene3d_delivery_artifacts (
  job_id uuid NOT NULL REFERENCES public.scene3d_deliveries(job_id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL,
  artifact_owner_id uuid NOT NULL,
  usage text NOT NULL CHECK (usage IN ('poster', 'validation')),
  via_revision_id uuid,
  PRIMARY KEY (job_id, artifact_id),
  FOREIGN KEY (artifact_id, artifact_owner_id) REFERENCES public.scene3d_artifacts(id, user_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS scene3d_deliveries_owner ON public.scene3d_deliveries(user_id);
CREATE INDEX IF NOT EXISTS scene3d_deliveries_workflow ON public.scene3d_deliveries(workflow_id);
CREATE INDEX IF NOT EXISTS scene3d_deliveries_source_owner ON public.scene3d_deliveries(source_owner_id);
CREATE INDEX IF NOT EXISTS scene3d_deliveries_source_workflow ON public.scene3d_deliveries(source_workflow_id);
CREATE INDEX IF NOT EXISTS scene3d_deliveries_source_job ON public.scene3d_deliveries(source_job_id);
CREATE INDEX IF NOT EXISTS scene3d_deliveries_source_revision ON public.scene3d_deliveries(source_revision_id);
CREATE INDEX IF NOT EXISTS scene3d_delivery_artifacts_asset ON public.scene3d_delivery_artifacts(artifact_id, artifact_owner_id);

ALTER TABLE public.scene3d_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene3d_delivery_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scene3d_deliveries, public.scene3d_delivery_artifacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene3d_deliveries, public.scene3d_delivery_artifacts TO service_role;

CREATE OR REPLACE FUNCTION public.scene3d_keep_delivery_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- A source job may disappear from history; its FK alone may be nulled.
  IF (to_jsonb(NEW) - 'source_job_id') IS DISTINCT FROM (to_jsonb(OLD) - 'source_job_id')
     OR (NEW.source_job_id IS NOT NULL AND NEW.source_job_id IS DISTINCT FROM OLD.source_job_id) THEN
    RAISE EXCEPTION 'Scene deliveries are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scene3d_delivery_immutable ON public.scene3d_deliveries;
CREATE TRIGGER scene3d_delivery_immutable BEFORE UPDATE ON public.scene3d_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.scene3d_keep_delivery_immutable();

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
  IF jsonb_array_length(v_entries) NOT BETWEEN 2 AND 3
     OR jsonb_array_length(v_entries) <> (SELECT count(DISTINCT e->>'artifact_id') FROM jsonb_array_elements(v_entries) e)
     OR (SELECT count(*) FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'poster') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(v_entries) e WHERE e->>'kind' = 'validation-report') < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_entries) e
       WHERE coalesce(e->>'kind' NOT IN ('poster', 'validation-report'), true)
          OR (e->>'usage') IS DISTINCT FROM CASE e->>'kind' WHEN 'poster' THEN 'poster' ELSE 'validation' END) THEN
    RAISE EXCEPTION 'Scene delivery requires a poster and validation report' USING ERRCODE = '55015';
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
      'byte_length', a.byte_length, 'bucket', a.bucket, 'object_key', a.object_key, 'etag', a.etag)
      ORDER BY p.artifact_id) INTO v_have
      FROM public.scene3d_delivery_artifacts p JOIN public.scene3d_artifacts a ON a.id = p.artifact_id
      WHERE p.job_id = v_job_id;
    SELECT jsonb_agg(jsonb_build_object('artifact_id', (e->>'artifact_id')::uuid,
      'artifact_owner_id', (e->>'artifact_owner_id')::uuid, 'usage', e->>'usage',
      'via_revision_id', nullif(e->>'via_revision_id', '')::uuid, 'kind', e->>'kind', 'sha256', e->>'sha256',
      'byte_length', (e->>'byte_length')::bigint, 'bucket', e->>'bucket', 'object_key', e->>'object_key', 'etag', e->>'etag')
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
    IF NOT FOUND OR v_source_job.user_id IS DISTINCT FROM v_user_id
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
    INSERT INTO public.scene3d_delivery_artifacts(job_id, artifact_id, artifact_owner_id, usage, via_revision_id)
    VALUES (v_job_id, (v_entry->>'artifact_id')::uuid, v_owner, v_entry->>'usage', v_via);
  END LOOP;
  RETURN 'created';
END;
$$;

-- A delivery pin retains bytes independently of the original revision's pins.
-- Cascaded final-pin deletion also makes non-expiring artifacts collectable.
CREATE OR REPLACE FUNCTION public.scene3d_sweep_expired_artifacts(max_rows integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_removed integer := 0;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  FOR v_id IN
    SELECT a.id FROM public.scene3d_artifacts a
    WHERE ((a.expires_at IS NOT NULL AND a.expires_at < now()) OR a.created_at < now() - interval '1 day')
      AND NOT EXISTS (SELECT 1 FROM public.scene3d_revision_artifacts p WHERE p.artifact_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM public.scene3d_delivery_artifacts p WHERE p.artifact_id = a.id)
    ORDER BY a.created_at LIMIT greatest(max_rows, 0)
  LOOP
    BEGIN
      DELETE FROM public.scene3d_artifacts WHERE id = v_id;
      IF FOUND THEN v_removed := v_removed + 1; END IF;
    EXCEPTION WHEN foreign_key_violation THEN
      NULL;
    END;
  END LOOP;
  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION public.scene3d_keep_delivery_immutable(), public.scene3d_publish_delivery(jsonb),
  public.scene3d_sweep_expired_artifacts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scene3d_keep_delivery_immutable(), public.scene3d_publish_delivery(jsonb),
  public.scene3d_sweep_expired_artifacts(integer) TO service_role;
