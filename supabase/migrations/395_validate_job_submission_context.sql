-- Validate separately so the table scan does not hold the column-addition lock.
ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_submission_context_object;
