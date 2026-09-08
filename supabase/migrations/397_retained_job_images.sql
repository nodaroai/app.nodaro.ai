-- A retained result keeps its server provenance even after gallery/job cleanup.
-- No FK to jobs/profiles: the destination workflow owns the retained lifetime.
CREATE TABLE IF NOT EXISTS public.retained_job_images (
  job_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES public.retained_images(id) ON DELETE CASCADE,
  submission_context jsonb NOT NULL CHECK (jsonb_typeof(submission_context) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retained_job_images_workflow ON public.retained_job_images(workflow_id);
ALTER TABLE public.retained_job_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retained_job_images FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.retained_job_images TO service_role;

CREATE OR REPLACE FUNCTION public.preserve_retained_job_image() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Retained job image is immutable'; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.workflows WHERE id = OLD.workflow_id) THEN
    RAISE EXCEPTION 'Retained job image belongs to an existing workflow';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.preserve_retained_job_image() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_retained_job_image() TO service_role;
DROP TRIGGER IF EXISTS preserve_retained_job_image ON public.retained_job_images;
CREATE TRIGGER preserve_retained_job_image BEFORE UPDATE OR DELETE ON public.retained_job_images
FOR EACH ROW EXECUTE FUNCTION public.preserve_retained_job_image();

-- Call only after downloading the completed imageUrl and verifying its retained
-- bytes. The database rechecks that source and copies provenance itself.
CREATE OR REPLACE FUNCTION public.record_retained_job_image(
  p_user_id uuid, p_workflow_id uuid, p_job_id uuid, p_image_id uuid, p_source_url text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_record public.retained_job_images; v_context jsonb;
BEGIN
  PERFORM 1 FROM public.workflows WHERE id = p_workflow_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_record FROM public.retained_job_images
    WHERE job_id = p_job_id AND user_id = p_user_id AND workflow_id = p_workflow_id;
  IF FOUND THEN RETURN to_jsonb(v_record); END IF;
  SELECT submission_context INTO v_context FROM public.jobs
    WHERE id = p_job_id AND user_id = p_user_id AND workflow_id = p_workflow_id
      AND status = 'completed' AND job_type IN ('generate-image','image-to-image')
      AND output_data->>'imageUrl' = p_source_url AND submission_context IS NOT NULL
    FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.retained_images WHERE id = p_image_id AND user_id = p_user_id
    AND workflow_id = p_workflow_id AND state = 'ready' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.retained_job_images(job_id,user_id,workflow_id,image_id,submission_context)
    VALUES (p_job_id,p_user_id,p_workflow_id,p_image_id,v_context)
    ON CONFLICT (job_id) DO NOTHING;
  SELECT * INTO v_record FROM public.retained_job_images
    WHERE job_id = p_job_id AND user_id = p_user_id AND workflow_id = p_workflow_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_record);
END $$;
REVOKE ALL ON FUNCTION public.record_retained_job_image(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_retained_job_image(uuid,uuid,uuid,uuid,text) TO service_role;
