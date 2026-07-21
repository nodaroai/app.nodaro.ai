-- GRACEFUL-STOP signal for checkpointed long-running jobs (generate-video-pro).
-- Deliberately NOT a status flip: the engine must still be able to COMPLETE the
-- job with its partial deliverable (markJobCompleted's live-status CAS refuses
-- cancelled rows). Stamped by the gvp stop route (workers/shared.ts
-- requestJobStop, service-role only — RLS untouched); observed by
-- lib/job-cancellation.ts's throttled ambient check, which throws
-- JobStopRequestedError so the engine dumps the in-flight segment, delivers
-- the stitched prefix, and settles fee + dispatched segments (rest refunded).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stop_requested_at TIMESTAMPTZ;
