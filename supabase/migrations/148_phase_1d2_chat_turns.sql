-- Phase 1D.2b — Guided Mode chat refinement.
-- pipeline_chat_turns: per-stage natural-language refinement turns at
-- chat-enabled stages (script in PR 2; shot_list + post_merge keys reserved
-- in CHAT_ENABLED_STAGES for future 1D.2d extension without schema change).

BEGIN;

CREATE TABLE IF NOT EXISTS pipeline_chat_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_stage_id uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  -- turn_n is sequential across ALL turns (user + assistant + apply-failure
  -- recovery assistants). Each user message normally creates 2 rows (user +
  -- assistant reply); apply-failure on a turn inserts an extra assistant row.
  -- Ceiling supports max user-turn cap (CHAT_TURN_CAPS.script = 20) × 3
  -- (user + normal assistant + worst-case error-recovery assistant) = 60.
  -- Per-stage caps enforced in app code by counting role='user' rows.
  turn_n int NOT NULL CHECK (turn_n >= 0 AND turn_n <= 60),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (length(content) > 0 AND length(content) <= 16000),
  proposed_change jsonb,                                       -- assistant only
  applied_to_attempt_id uuid REFERENCES pipeline_stage_attempts(id) ON DELETE SET NULL,
  llm_call_id uuid REFERENCES llm_calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_stage_id, turn_n),
  -- M6: every assistant turn must be tied to llm_calls for audit + cost accounting.
  CONSTRAINT chat_turns_llm_call_required_for_assistant
    CHECK (role = 'user' OR llm_call_id IS NOT NULL),
  -- Only assistant turns may carry a proposed_change.
  CONSTRAINT chat_turns_proposed_change_assistant_only
    CHECK (role = 'assistant' OR proposed_change IS NULL),
  -- Only assistant turns may be applied.
  CONSTRAINT chat_turns_applied_assistant_only
    CHECK (role = 'assistant' OR applied_to_attempt_id IS NULL)
);

CREATE INDEX IF NOT EXISTS pipeline_chat_turns_stage_idx
  ON pipeline_chat_turns (pipeline_stage_id, turn_n);

ALTER TABLE pipeline_chat_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_chat_turns_owner ON pipeline_chat_turns
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM pipeline_stages ps
      JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE ps.id = pipeline_chat_turns.pipeline_stage_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM pipeline_stages ps
      JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE ps.id = pipeline_chat_turns.pipeline_stage_id
        AND p.user_id = auth.uid()
    )
  );

-- Chat costs roll into the pipeline upfront estimate (extended in
-- backend/src/ee/pipelines/credits.ts:estimateUpfrontCredits). No new
-- model_pricing row needed — chat LLM calls go through the same
-- pipeline-billed-against-upfront path as Script Critic, Cast Coverage Critic,
-- and Showrunner.

COMMIT;
