-- Migration 132 — Phase 1B.4 schema (live canvas + resume + mid-flight + depends_on + helper-audit)
--
-- Five orthogonal subsystems share one migration to keep DB writes atomic
-- and avoid 5 concurrent-merge collisions on consecutive numbers.
-- (Renumbered 131→132 during merge to avoid collision with 131_seed_suno_voice_create_pricing.sql.)
--
-- Subsystems:
--   A. pipeline_entities.depends_on + is_stale + cascade staleness trigger
--   B. pipeline_entity_nodes.pipeline_state + last_state_change_at (re-asserted)
--   C. pipelines.{forked_at, fork_reason, resume_count, forked_status} + status CHECK adds 'forked'
--   D. pipeline_stage_attempts trigger CHECK extended via `LIKE 'scene_helper:%'`
--   E. pipeline_entities.is_forked default re-assert (drift safety)
--   F. pipeline_stages.awaiting_reason (drift detection in Section H)
--
-- NOTE on CHECK constraint drops: migration 121 defined several CHECKs inline
-- on column definitions; Postgres auto-names those `<table>_<col>_check`.
-- This migration drops BOTH the auto-named CHECK AND any future named CHECK
-- so re-runs and partial-migration recoveries are both safe.

-- ───────────────────────────────────────────────────────────────────────
-- A. pipeline_entities: depends_on (uuid[]) + is_stale (bool) + cascade trigger
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.pipeline_entities
  ADD COLUMN IF NOT EXISTS depends_on uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS pipeline_entities_depends_on_gin
  ON public.pipeline_entities USING GIN (depends_on);

-- Cascading staleness — when main_asset_id changes, mark all transitive dependents stale.
-- Recursive CTE marches from upstream (the changed row) to downstream dependents:
--   base case: rows whose depends_on contains NEW.id
--   recursive case: rows whose depends_on contains any already-collected dependent
-- Bounded by pipeline_id to keep cross-pipeline cascades from leaking.
CREATE OR REPLACE FUNCTION public.cascade_pipeline_entity_staleness()
RETURNS trigger
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.main_asset_id IS DISTINCT FROM OLD.main_asset_id THEN
    WITH RECURSIVE dependents AS (
      SELECT id FROM public.pipeline_entities
        WHERE NEW.id = ANY(depends_on)
          AND pipeline_id = NEW.pipeline_id
      UNION
      SELECT pe.id
        FROM public.pipeline_entities pe
        JOIN dependents d ON d.id = ANY(pe.depends_on)
        WHERE pe.pipeline_id = NEW.pipeline_id
    )
    UPDATE public.pipeline_entities
      SET is_stale = true
      WHERE id IN (SELECT id FROM dependents)
        AND is_stale = false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS pipeline_entities_cascade_stale ON public.pipeline_entities;
CREATE TRIGGER pipeline_entities_cascade_stale
  AFTER UPDATE OF main_asset_id ON public.pipeline_entities
  FOR EACH ROW EXECUTE FUNCTION public.cascade_pipeline_entity_staleness();

-- ───────────────────────────────────────────────────────────────────────
-- B. pipeline_entity_nodes: pipeline_state (text enum) + last_state_change_at
-- ───────────────────────────────────────────────────────────────────────
-- pipeline_state column already exists from migration 121 (line 196) with the
-- correct default + inline CHECK. The ALTERs below are no-ops on a clean DB
-- but provide safety on partial-migration clusters.

ALTER TABLE public.pipeline_entity_nodes
  ADD COLUMN IF NOT EXISTS pipeline_state text NOT NULL DEFAULT 'pipeline_owned_running',
  ADD COLUMN IF NOT EXISTS last_state_change_at timestamptz NOT NULL DEFAULT now();

-- Drop both the auto-named CHECK from migration 121 AND any prior named CHECK
-- before re-asserting (idempotent across re-runs).
ALTER TABLE public.pipeline_entity_nodes
  DROP CONSTRAINT IF EXISTS pipeline_entity_nodes_pipeline_state_check;
ALTER TABLE public.pipeline_entity_nodes
  DROP CONSTRAINT IF EXISTS pipeline_entity_nodes_state_chk;
ALTER TABLE public.pipeline_entity_nodes
  ADD CONSTRAINT pipeline_entity_nodes_state_chk
    CHECK (pipeline_state IN (
      'pipeline_owned_running',
      'pipeline_owned_awaiting_approval',
      'pipeline_owned_approved',
      'pipeline_orphaned'
    ));

CREATE INDEX IF NOT EXISTS pipeline_entity_nodes_state_idx
  ON public.pipeline_entity_nodes (pipeline_state)
  WHERE pipeline_state != 'pipeline_orphaned';

-- ───────────────────────────────────────────────────────────────────────
-- C. pipelines: forked_at + fork_reason + resume_count + forked_status
-- ───────────────────────────────────────────────────────────────────────
-- forked_at + fork_reason already exist from migration 121 (lines 48-49).
-- resume_count + forked_status are new in 1B.4.
-- IF NOT EXISTS preserves the original CHECK on fork_reason from 121.

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS forked_at timestamptz,
  ADD COLUMN IF NOT EXISTS fork_reason text,
  ADD COLUMN IF NOT EXISTS resume_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forked_status text;
-- forked_status mirrors `status` at fork time so we can show "Forked from approval"
-- vs "Forked mid-Stage-5" in the UI.

-- Re-assert resume_count CHECK (idempotent; the column-level CHECK from a
-- future re-run would conflict otherwise).
ALTER TABLE public.pipelines
  DROP CONSTRAINT IF EXISTS pipelines_resume_count_check;
ALTER TABLE public.pipelines
  DROP CONSTRAINT IF EXISTS pipelines_resume_count_chk;
ALTER TABLE public.pipelines
  ADD CONSTRAINT pipelines_resume_count_chk
    CHECK (resume_count <= 3);

-- Extend status CHECK to allow 'forked'. Migration 121's inline CHECK already
-- includes 'forked' (line 20), but we re-assert with a named constraint so
-- future extensions are easier. Drop both the auto-named AND the prior-named
-- CHECK to stay idempotent.
ALTER TABLE public.pipelines
  DROP CONSTRAINT IF EXISTS pipelines_status_check;
ALTER TABLE public.pipelines
  DROP CONSTRAINT IF EXISTS pipelines_status_chk;
ALTER TABLE public.pipelines
  ADD CONSTRAINT pipelines_status_chk
    CHECK (status IN (
      'queued',
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'cancelled',
      'forked'
    ));

-- ───────────────────────────────────────────────────────────────────────
-- D. pipeline_stage_attempts: extend trigger CHECK to allow scene_helper:*
-- ───────────────────────────────────────────────────────────────────────
-- Migration 121's inline CHECK (auto-named pipeline_stage_attempts_trigger_check)
-- forbids 'scene_helper:audit_prompt' etc. Phase 1B.3 deferred this; we now
-- extend the CHECK with a regex prefix. CRITICAL: must drop the auto-named
-- CHECK from 121 or both will apply and the new helper triggers will still be
-- rejected.

ALTER TABLE public.pipeline_stage_attempts
  DROP CONSTRAINT IF EXISTS pipeline_stage_attempts_trigger_check;
ALTER TABLE public.pipeline_stage_attempts
  DROP CONSTRAINT IF EXISTS pipeline_stage_attempts_trigger_chk;
ALTER TABLE public.pipeline_stage_attempts
  ADD CONSTRAINT pipeline_stage_attempts_trigger_chk
    CHECK (
      trigger IN (
        'initial',
        'critic_retry',
        'resume',
        'user_edit',
        'chat_refine',
        'director_replan'
      )
      OR trigger LIKE 'scene_helper:%'
    );

-- ───────────────────────────────────────────────────────────────────────
-- E. pipeline_entities: is_forked default re-assert
-- ───────────────────────────────────────────────────────────────────────
-- Migration 121 (line 169) already added is_forked NOT NULL DEFAULT false.
-- This DO block is a safety net for any cluster where a partial migration
-- left the column missing.

DO $$ BEGIN
  ALTER TABLE public.pipeline_entities ALTER COLUMN is_forked SET DEFAULT false;
EXCEPTION WHEN undefined_column THEN
  ALTER TABLE public.pipeline_entities ADD COLUMN is_forked boolean NOT NULL DEFAULT false;
END $$;

-- ───────────────────────────────────────────────────────────────────────
-- F. pipeline_stages: awaiting_reason (Section H drift detection)
-- ───────────────────────────────────────────────────────────────────────
-- Set when the engine pauses a stage at 'awaiting_approval' due to drift —
-- value 'canvas_drift' triggers the DriftBanner in the pipeline panel.

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS awaiting_reason text;
