-- Trusted per-job provenance is written with the job itself. It is separate
-- from input_data, which may contain caller-provided JSON and is publicly read.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS submission_context jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_submission_context_object') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_submission_context_object
      CHECK (submission_context IS NULL OR jsonb_typeof(submission_context) = 'object') NOT VALID;
  END IF;
END $$;

-- Migration 347 removed table-level SELECT. The new column deliberately stays
-- outside its four-column browser/Realtime grant and outside public job views.
REVOKE SELECT (submission_context) ON public.jobs FROM PUBLIC, anon, authenticated;

-- Keep the existing ownership/status policies and add a restrictive check so
-- no permissive INSERT policy can let clients forge server provenance.
DROP POLICY IF EXISTS "Server controls job submission context" ON public.jobs;
CREATE POLICY "Server controls job submission context" ON public.jobs
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (submission_context IS NULL);

CREATE OR REPLACE FUNCTION public.preserve_job_submission_context() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.submission_context IS DISTINCT FROM OLD.submission_context THEN
    RAISE EXCEPTION 'Job submission context is immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_job_submission_context() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS preserve_job_submission_context ON public.jobs;
CREATE TRIGGER preserve_job_submission_context
  BEFORE UPDATE OF submission_context ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.preserve_job_submission_context();
