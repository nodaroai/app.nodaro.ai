-- Migration 156 — pipelines.current_progress_message
--
-- Persists the most recent transient progress event ("Drafting plan (3.4 KB
-- so far)…", etc.) so a user who refreshes mid-stream or opens the panel
-- for the first time during an in-flight LLM call sees the banner IMMEDIATELY
-- — instead of staring at an empty panel for up to ~750ms waiting for the
-- next live SSE event to fire.
--
-- Why a single column (not a separate `pipeline_progress_events` table):
--   - Progress messages are ephemeral by design. The "last value wins"
--     semantics matches the UI use case exactly (only the latest message is
--     ever rendered).
--   - A column is one UPDATE per ~750ms throttle window vs an INSERT per
--     event — same row, no append-only churn.
--   - Avoids retention/cleanup logic for old events.
--
-- The text column is intentionally nullable: pipelines that aren't currently
-- streaming (queued, awaiting_approval, completed, etc.) carry NULL.
-- callLLM's onProgress sets it during LLM streaming; the cancel/completion
-- paths clear it back to NULL on terminal transitions.

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS current_progress_message text;

COMMENT ON COLUMN public.pipelines.current_progress_message IS
  'Most-recent transient progress message ("Drafting plan…") shown in the streaming banner. Written by callLLM''s onProgress throttle window; cleared on stage transition. NULL when no LLM is mid-stream.';
