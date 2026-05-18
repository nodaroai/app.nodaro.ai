-- Migration: seed model_pricing rows for the seven Scene-Context helper
-- identifiers used by the SceneNode "scene-context" panel (§6.11).
--
-- These helpers are LLM-driven micro-actions invoked from a Scene node's
-- context panel. Each runs synchronously through llmComplete() and reserves
-- credits via the matching identifier below. STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts is the runtime fallback; the admin UI
-- (`/admin/models`) reads pricing exclusively from this table, so without
-- these rows the helpers are invisible / not overrideable from the admin.
--
-- Per CLAUDE.md "Provider Enum Sync" step 9, every key in STATIC_CREDIT_COSTS
-- needs a matching INSERT here.
--
-- Identifier format: scene-helper:<action_id>

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- Haiku: text-only scene-context check for shot prompt contradictions
  ('scene-helper:audit_prompt',           1, true, 'scene-helper'),

  -- Sonnet: rewrites shot action/motion/dialogue with model-aware phrasing
  ('scene-helper:improve_prompt',         2, true, 'scene-helper'),

  -- Haiku: fills motion_prompt for selected shots
  ('scene-helper:generate_motion',        1, true, 'scene-helper'),

  -- Sonnet: rewrites all shots for current video_model prompting style
  ('scene-helper:optimize_for_model',     3, true, 'scene-helper'),

  -- Sonnet: proposes 1-4 insert shots (reaction/cutaway/establishing/transition)
  ('scene-helper:add_broll',              2, true, 'scene-helper'),

  -- Sonnet: generates bridge_image_prompt for i2i edit between shots
  ('scene-helper:bridge_to_next_scene',   2, true, 'scene-helper'),

  -- Sonnet plans prompt + 1 image gen (master scene keyframe)
  ('scene-helper:anchor_scene_style',     5, true, 'scene-helper')

ON CONFLICT (model_identifier) DO NOTHING;
