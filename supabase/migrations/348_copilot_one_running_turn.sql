-- Migration 348: one live copilot turn per thread, enforced by the database (#903).
--
-- The message route serialises turns with a check-then-act: it asks
-- `findLiveTurn`, and only ~100-300 ms later — after the job insert and the
-- credit reservation — does it write the row that would make the answer yes.
-- A second request landing inside that window passed the same check and
-- reserved its own credits, so two near-simultaneous first messages on one
-- thread were BOTH charged.
--
-- This adds no restriction. Refusing a second concurrent turn on the same
-- thread is deliberate and already implemented (the copilot edits the canvas;
-- two turns on one workflow means two models writing over each other). The
-- index only makes the existing refusal hold when both requests land inside
-- the window, by turning it into an invariant of the data rather than of
-- request timing. Threads are per (user, workflow), so two windows on
-- DIFFERENT workflows are unaffected — as they always were.

-- 1. Make the invariant true before asserting it.
--
-- A turn whose process died leaves a `running` row behind, and the heal path
-- is lazy (it runs on the thread's next request), so duplicates can be sitting
-- in the table right now. A unique index would fail on them, and a failed
-- migrate job on `main` blocks the production deploy.
--
-- Money is safe: settlement is keyed off the JOB row (the reconcile cron scans
-- `jobs` left at pending/processing, and `reconcileCopilotTurn` finds the turn
-- by `job_id` whatever its status), never off this column. Demoting the row
-- strands nothing — it only stops the row from wedging its thread.
UPDATE public.copilot_turns AS t
SET status = 'failed',
    finished_at = COALESCE(t.finished_at, now()),
    error = COALESCE(t.error, 'superseded_pre_unique_index')
WHERE t.status = 'running'
  AND EXISTS (
    SELECT 1
    FROM public.copilot_turns AS newer
    WHERE newer.thread_id = t.thread_id
      AND newer.status = 'running'
      AND (newer.started_at, newer.id) > (t.started_at, t.id)
  );

-- 2. The invariant. Partial, so finished turns are unconstrained and a thread
--    keeps its full history.
CREATE UNIQUE INDEX IF NOT EXISTS copilot_turns_one_running_per_thread
  ON public.copilot_turns (thread_id)
  WHERE status = 'running';
