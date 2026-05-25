-- Phase 3 (granular-pipeline-control spec) — Stage 2 Character Wizard, Step A.
--
-- Two enum additions to pipeline_entities.status:
--   * 'pending_description' — initial state for character entities in manual/
--     guided mode pipelines. Indicates the engine should NOT auto-generate
--     the portrait; instead wait for the user to walk through the Step A
--     wizard and call POST /entities/:id/approve-description (which then
--     flips the entity to 'pending' so the engine picks it up). In auto
--     mode, the stage handler bulk-flips pending_description → pending at
--     stage start, preserving today's auto-generate behavior.
--   * 'skipped' — terminal state for entities the user explicitly skipped
--     via POST /entities/:id/skip. No image generated; entity is excluded
--     from stage-advance gating (treated as resolved alongside 'approved').
--
-- One new column on pipeline_stages:
--   * stage_completion_blocked_reason — surfaces to the UI why a stage
--     can't advance yet (e.g., "2 characters still need description
--     approval"). Set by the stage-advance gate when called against a
--     stage whose entities aren't all approved/skipped. NULL when the
--     stage is advanceable. Defensive guard for programmatic API misuse;
--     happy-path UI never tries to advance a non-ready stage.

ALTER TABLE public.pipeline_entities
    DROP CONSTRAINT IF EXISTS pipeline_entities_status_check;

ALTER TABLE public.pipeline_entities
    ADD CONSTRAINT pipeline_entities_status_check
        CHECK (status IN (
            'pending',
            'generating',
            'awaiting_approval',
            'approved',
            'rejected',
            'failed',
            'pending_description',
            'skipped'
        ));

ALTER TABLE public.pipeline_stages
    ADD COLUMN IF NOT EXISTS stage_completion_blocked_reason text;
