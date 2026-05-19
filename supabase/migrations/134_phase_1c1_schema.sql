-- Migration 134 — Phase 1C.1 schema (Stages 6/7/8 + pipeline config + Image Critic audit)
--
-- Five subsystems share one migration:
--   A. pipeline_stages.stage_name CHECK extension (re-assert with named constraint)
--   B. pipelines.config JSONB — flip existing nullable column to NOT NULL DEFAULT '{}'
--   C. pipelines.final_output_asset_id — Stage 8 (post_merge) writes the final asset id here
--   D. image_critic_verdicts audit table (separate from llm_calls for stage_7b_pre + 3 helpers)
--   E. Seed model_pricing for the 3 newly-active vision-keyframe helpers
--      (audit_images / fix_continuity / validate_match_cut)
--
-- Renumbered from 133 → 134 during merge (133 taken by 133_seedance_2_1080p_pricing.sql).
--
-- NOTE on CHECK constraint drops (mirrors 132_phase_1b4_schema.sql pattern):
-- migration 121 defined `pipeline_stages.stage_name` CHECK inline on the column
-- definition; Postgres auto-named it `pipeline_stages_stage_name_check`. This
-- migration drops BOTH the auto-named CHECK AND any future named `_chk` CHECK
-- so re-runs and partial-migration recoveries are both safe.

-- ───────────────────────────────────────────────────────────────────────
-- A. pipeline_stages.stage_name CHECK extension
-- ───────────────────────────────────────────────────────────────────────
-- The set of stage names is unchanged from migration 121's inline CHECK
-- (which already included scene_images / animate_audio_edit / post_merge),
-- but we re-assert with a named constraint so future extensions are easier.
-- Drop BOTH names before re-add to stay idempotent.

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_stage_name_check;
ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_stage_name_chk;
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_stage_name_chk
    CHECK (stage_name IN (
      'script',
      'characters',
      'objects',
      'locations',
      'shot_list',
      'scene_images',
      'animate_audio_edit',
      'post_merge'
    ));

-- ───────────────────────────────────────────────────────────────────────
-- B. pipelines.config JSONB — flip nullable → NOT NULL DEFAULT '{}'
-- ───────────────────────────────────────────────────────────────────────
-- Migration 121 (line 35) already added `config jsonb` as a NULLABLE column
-- with NO default. `ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT '{}'::jsonb`
-- would be a no-op (Postgres short-circuits the whole statement when the
-- column exists). Use the three-step idempotent flip instead:
--   1. ADD COLUMN IF NOT EXISTS  (no-op on existing schemas, creates on new)
--   2. UPDATE … SET config = '{}'::jsonb WHERE config IS NULL  (backfill)
--   3. ALTER COLUMN SET DEFAULT + SET NOT NULL  (idempotent)
--
-- shape: { shot_generation_mode?: "parallel" | "sequential", lipsync_enabled?: boolean }

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS config JSONB;

UPDATE public.pipelines
  SET config = '{}'::jsonb
  WHERE config IS NULL;

ALTER TABLE public.pipelines
  ALTER COLUMN config SET DEFAULT '{}'::jsonb;

ALTER TABLE public.pipelines
  ALTER COLUMN config SET NOT NULL;

-- ───────────────────────────────────────────────────────────────────────
-- C. pipelines.final_output_asset_id
-- ───────────────────────────────────────────────────────────────────────
-- Stage 8 (post_merge) concatenates all scene composite videos into a
-- single final MP4 and persists the asset id here. Separate from
-- `final_asset_id` (line 58 of 121) which is reserved for the broader
-- "pipeline output asset" — Stage 8 specifically writes the merged-video id.

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS final_output_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL;

-- ───────────────────────────────────────────────────────────────────────
-- D. image_critic_verdicts audit table
-- ───────────────────────────────────────────────────────────────────────
-- Separate from llm_calls so we can store the verdict_ok / issues / shot_id
-- as first-class queryable columns instead of buried in llm_calls.error/output.
-- Used by Stage 7b pre-check AND the 3 user-triggered helpers
-- (audit_images / fix_continuity / validate_match_cut).

CREATE TABLE IF NOT EXISTS public.image_critic_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  pipeline_entity_id uuid REFERENCES public.pipeline_entities(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  shot_id text,
  invoked_via text NOT NULL CHECK (invoked_via IN (
    'stage_7b_pre',
    'helper:audit_images',
    'helper:fix_continuity',
    'helper:validate_match_cut'
  )),
  verdict_ok boolean NOT NULL,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  llm_call_id uuid REFERENCES public.llm_calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_critic_verdicts_pipeline_idx
  ON public.image_critic_verdicts (pipeline_id, created_at DESC);

CREATE INDEX IF NOT EXISTS image_critic_verdicts_entity_idx
  ON public.image_critic_verdicts (pipeline_entity_id)
  WHERE pipeline_entity_id IS NOT NULL;

ALTER TABLE public.image_critic_verdicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS image_critic_verdicts_owner ON public.image_critic_verdicts;
CREATE POLICY image_critic_verdicts_owner ON public.image_critic_verdicts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = image_critic_verdicts.pipeline_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = image_critic_verdicts.pipeline_id
        AND p.user_id = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────────────────────
-- E. Seed model_pricing for the 3 newly-active vision-keyframe helpers
-- ───────────────────────────────────────────────────────────────────────
-- Phase 1B.3 pre-allocated these identifiers but left them disabled with
-- "Pending Phase 1C" tooltips. Phase 1C.1 activates them. Static fallback
-- in STATIC_CREDIT_COSTS still applies; this row is the admin-overrideable
-- source of truth (admin UI reads from this table only — see
-- CLAUDE.md "Provider Enum Sync" step 9).

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('scene-helper:audit_images',       3, true, 'scene-helper'),
  ('scene-helper:fix_continuity',     4, true, 'scene-helper'),
  ('scene-helper:validate_match_cut', 3, true, 'scene-helper')
ON CONFLICT (model_identifier) DO NOTHING;
