-- 723 — public.jobs, alone in this file: the columns a routed run and a
-- background clip assembly keep on their job, and the trigger that queues a
-- delivered routed job's settlement (722 holds the function).
--
-- Locks: ACCESS EXCLUSIVE on jobs from the first statement until the file
-- commits, and on no other table. Every statement is metadata-only — nullable
-- columns with no default, a constraint added NOT VALID, column privileges,
-- two policies, a trigger — so nothing reads or rewrites the table. The
-- lock_timeout bounds the wait for that lock behind a long transaction: a
-- failed migration that is simply run again (every statement is re-runnable),
-- never jobs queued behind it. Apply off-peak.
SET LOCAL lock_timeout = '2s';

-- A provider submission may be in flight before its task ID is returned.
-- Stop uses the same compare-and-set marker as submission, for every supplier.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS video_send_started_at timestamptz;

-- The service stores the bound run token and the facts required to replay
-- delivery. Keep this column outside the browser's job grants.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS video_route_addons_base integer;
-- NOT VALID: new and changed rows are checked; the existing rows (all NULL in
-- a column added just above) are not read to prove it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_video_route_addons_base_check' AND conrelid = 'public.jobs'::regclass) THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_video_route_addons_base_check CHECK (video_route_addons_base >= 0) NOT VALID;
  END IF;
END;
$$;
REVOKE SELECT (metadata), UPDATE (metadata) ON public.jobs FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Server controls routed run metadata" ON public.jobs;
CREATE POLICY "Server controls routed run metadata" ON public.jobs
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (video_route_addons_base IS NULL AND NOT (coalesce(metadata, '{}'::jsonb) ? 'videoRouteRun'));

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS video_assembly_recovery jsonb;
REVOKE SELECT (video_assembly_recovery), UPDATE (video_assembly_recovery) ON public.jobs FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Server schedules clip assembly" ON public.jobs;
CREATE POLICY "Server schedules clip assembly" ON public.jobs AS RESTRICTIVE
  FOR INSERT TO anon, authenticated WITH CHECK (video_assembly_recovery IS NULL);

CREATE OR REPLACE TRIGGER queue_completed_video_settlement BEFORE UPDATE OF status ON public.jobs
  FOR EACH ROW WHEN (NEW.status IN ('completed','failed','cancelled') AND OLD.status IS DISTINCT FROM NEW.status AND NEW.usage_log_id IS NOT NULL)
  EXECUTE FUNCTION public.queue_completed_video_settlement();
