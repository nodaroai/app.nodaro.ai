-- Redrive latch — root fix for the pipeline lost wake-up.
--
-- `enqueuePipelineRun` dedupes on a deterministic BullMQ jobId (`pipeline-<id>`);
-- `add()` is a silent no-op when a drive for that pipeline is already `active`.
-- A re-drive requested mid-drive (user approves an entity, a stage auto-advances,
-- a retry fires) is therefore dropped, and once the active drive finishes nothing
-- re-triggers the pipeline — it stalls at `status='running'` with no error.
-- See specs/stuck-execution-prevention-plan.md "Phase 4".
--
-- This column is the latch: `enqueuePipelineRun` stamps it before `add()`; the
-- pipeline-worker (`driveWithRedriveLatch`) clears it before each drive and loops
-- if a newer stamp lands mid-drive, so the dropped wake-up is coalesced into one
-- more drive instead of being lost. Always queried by pipeline id (PK), so no
-- index is needed.
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS pending_redrive_at timestamptz;
