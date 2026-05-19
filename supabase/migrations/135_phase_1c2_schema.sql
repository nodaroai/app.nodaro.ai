-- Migration 135 — Phase 1C.2 schema (Editor LLM + cut-decision audit + pricing seeds)
--
-- Two subsystems share one migration:
--   A. editor_decisions audit table — one row per cut decision the Editor LLM
--      emits (or a human-override patch applied during silent-cut-preview).
--      Stored separately from llm_calls so transition_type / offsets / beat-snap
--      values are queryable first-class columns.
--   B. Seed model_pricing for the 5 new Phase 1C.2 credit identifiers
--      (Editor LLM, beat-grid extract, music timeline build, final merge,
--       FreeCut export).
--
-- NO new columns on existing tables — `pipeline_stages.output` is already JSONB
-- and absorbs the new `current_sub_gate` shape without a CHECK extension.

-- ───────────────────────────────────────────────────────────────────────
-- A. editor_decisions audit table
-- ───────────────────────────────────────────────────────────────────────
-- Mirrors the image_critic_verdicts shape from migration 134: one row per
-- decision, scoped to pipeline_id (cascade delete), optional pipeline_entity_id
-- (the scene), optional shot_id (text — matches ShotSpec.shot_id regex).
-- transition_type CHECK pins the 4-value enum; numeric offsets are nullable
-- so a "hard_cut at scene start" decision can omit them.

CREATE TABLE IF NOT EXISTS public.editor_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  pipeline_entity_id uuid REFERENCES public.pipeline_entities(id) ON DELETE SET NULL,
  shot_id text,
  transition_type text NOT NULL CHECK (transition_type IN (
    'hard_cut',
    'dissolve',
    'match_cut',
    'overlap'
  )),
  in_offset_sec numeric,
  out_offset_sec numeric,
  transition_duration_sec numeric,
  beat_snap_seconds numeric,
  dialogue_zone_respected boolean,
  llm_call_id uuid REFERENCES public.llm_calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_decisions_pipeline_idx
  ON public.editor_decisions (pipeline_id, created_at DESC);

CREATE INDEX IF NOT EXISTS editor_decisions_entity_idx
  ON public.editor_decisions (pipeline_entity_id)
  WHERE pipeline_entity_id IS NOT NULL;

ALTER TABLE public.editor_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS editor_decisions_owner ON public.editor_decisions;
CREATE POLICY editor_decisions_owner ON public.editor_decisions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = editor_decisions.pipeline_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = editor_decisions.pipeline_id
        AND p.user_id = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────────────────────
-- B. Seed model_pricing for the 5 new Phase 1C.2 credit identifiers
-- ───────────────────────────────────────────────────────────────────────
-- Mirrors the seed pattern from migration 134 (line 143) — admin UI reads
-- from model_pricing only, so each identifier MUST appear here even when
-- STATIC_CREDIT_COSTS already carries the fallback.
--
-- Categories:
--   'pipeline-llm'    — LLM-backed pipeline operations
--   'pipeline-system' — system operations (ffmpeg / beat extract / merge / export)
--
-- credit_cost values are conservative one-time defaults; tune via
-- `audit-credits` skill after the first week of usage data.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('pipeline-editor-llm',         3, true, 'pipeline-llm'),
  ('pipeline-beat-grid-extract',  0, true, 'pipeline-system'),
  ('pipeline-music-timeline',     4, true, 'pipeline-system'),
  ('pipeline-final-merge',        3, true, 'pipeline-system'),
  ('pipeline-freecut-export',     0, true, 'pipeline-system')
ON CONFLICT (model_identifier) DO NOTHING;
