-- Allow jobs without a workflow (direct generation, e.g. E2E spike)
ALTER TABLE public.jobs ALTER COLUMN workflow_id DROP NOT NULL;
