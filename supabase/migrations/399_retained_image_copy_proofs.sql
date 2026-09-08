-- Copy proofs have their own identity. They are not jobs and never grant a
-- review decision. Source context survives source workflow/job deletion.
CREATE TABLE IF NOT EXISTS public.retained_image_copies (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES public.retained_images(id) ON DELETE CASCADE,
  source_workflow_id uuid NOT NULL,
  source_job_id uuid,
  source_copy_id uuid,
  source_context jsonb NOT NULL CHECK (jsonb_typeof(source_context) = 'object'),
  origin_workflow_id uuid NOT NULL,
  origin_job_id uuid NOT NULL,
  origin_submission_context jsonb NOT NULL CHECK (jsonb_typeof(origin_submission_context) = 'object'),
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_job_id IS NULL) <> (source_copy_id IS NULL)),
  CHECK (id IS DISTINCT FROM source_copy_id)
);
CREATE INDEX IF NOT EXISTS retained_image_copies_workflow ON public.retained_image_copies(workflow_id);
ALTER TABLE public.retained_image_copies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_image_copies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_image_copies TO service_role;
DROP TRIGGER IF EXISTS preserve_retained_image_copy ON public.retained_image_copies;
CREATE TRIGGER preserve_retained_image_copy BEFORE UPDATE OR DELETE ON public.retained_image_copies
FOR EACH ROW EXECUTE FUNCTION public.preserve_retained_job_image();

-- The trusted integration authorizes source read + destination edit and
-- validates its mapped context. The database copies source proof itself and
-- verifies equal ready image hashes/dimensions within the two workflows.
CREATE OR REPLACE FUNCTION public.record_retained_image_copy(
  p_id uuid, p_user_id uuid, p_workflow_id uuid, p_image_id uuid,
  p_source_workflow_id uuid, p_source_job_id uuid, p_source_copy_id uuid, p_context jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prior public.retained_image_copies;
  v_job public.retained_job_images;
  v_copy public.retained_image_copies;
  v_source public.retained_images;
  v_destination public.retained_images;
  v_source_context jsonb; v_origin_context jsonb; v_origin_workflow uuid; v_origin_job uuid;
BEGIN
  IF (p_source_job_id IS NULL) = (p_source_copy_id IS NULL) OR p_id = p_source_copy_id
    OR p_context IS NULL OR jsonb_typeof(p_context) <> 'object' OR octet_length(p_context::text) > 262144 THEN
    RAISE EXCEPTION 'Invalid retained image copy' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.workflows WHERE id = p_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_prior FROM public.retained_image_copies WHERE id = p_id;
  IF FOUND THEN
    IF v_prior.user_id = p_user_id AND v_prior.workflow_id = p_workflow_id AND v_prior.image_id = p_image_id
      AND v_prior.source_workflow_id = p_source_workflow_id
      AND v_prior.source_job_id IS NOT DISTINCT FROM p_source_job_id
      AND v_prior.source_copy_id IS NOT DISTINCT FROM p_source_copy_id AND v_prior.context = p_context THEN
      RETURN to_jsonb(v_prior);
    END IF;
    RAISE EXCEPTION 'Retained image copy conflict' USING ERRCODE = '23505';
  END IF;
  PERFORM 1 FROM public.workflows WHERE id = p_source_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_source_job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM public.retained_job_images
      WHERE workflow_id = p_source_workflow_id AND job_id = p_source_job_id FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO v_source FROM public.retained_images
      WHERE id = v_job.image_id AND workflow_id = p_source_workflow_id AND state = 'ready' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_source_context := v_job.submission_context;
    v_origin_context := v_job.submission_context;
    v_origin_workflow := v_job.workflow_id; v_origin_job := v_job.job_id;
  ELSE
    SELECT * INTO v_copy FROM public.retained_image_copies
      WHERE workflow_id = p_source_workflow_id AND id = p_source_copy_id FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT * INTO v_source FROM public.retained_images
      WHERE id = v_copy.image_id AND workflow_id = p_source_workflow_id AND state = 'ready' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_source_context := v_copy.context;
    v_origin_context := v_copy.origin_submission_context;
    v_origin_workflow := v_copy.origin_workflow_id; v_origin_job := v_copy.origin_job_id;
  END IF;
  SELECT * INTO v_destination FROM public.retained_images
    WHERE id = p_image_id AND workflow_id = p_workflow_id AND user_id = p_user_id AND state = 'ready' FOR SHARE;
  IF NOT FOUND OR v_source.sha256 <> v_destination.sha256
    OR v_source.byte_length <> v_destination.byte_length OR v_source.width <> v_destination.width
    OR v_source.height <> v_destination.height OR v_source.content_type <> v_destination.content_type THEN RETURN NULL; END IF;
  INSERT INTO public.retained_image_copies(id,user_id,workflow_id,image_id,source_workflow_id,source_job_id,source_copy_id,
    source_context,origin_workflow_id,origin_job_id,origin_submission_context,context)
    VALUES (p_id,p_user_id,p_workflow_id,p_image_id,p_source_workflow_id,p_source_job_id,p_source_copy_id,
      v_source_context,v_origin_workflow,v_origin_job,v_origin_context,p_context)
    ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_prior FROM public.retained_image_copies WHERE id = p_id;
  IF v_prior.user_id IS DISTINCT FROM p_user_id OR v_prior.workflow_id <> p_workflow_id OR v_prior.image_id <> p_image_id
    OR v_prior.source_workflow_id <> p_source_workflow_id
    OR v_prior.source_job_id IS DISTINCT FROM p_source_job_id
    OR v_prior.source_copy_id IS DISTINCT FROM p_source_copy_id OR v_prior.context <> p_context THEN
    RAISE EXCEPTION 'Retained image copy conflict' USING ERRCODE = '23505';
  END IF;
  RETURN to_jsonb(v_prior);
END $$;
REVOKE ALL ON FUNCTION public.record_retained_image_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_retained_image_copy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb) TO service_role;
