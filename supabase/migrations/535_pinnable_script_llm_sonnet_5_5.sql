-- 535_pinnable_script_llm_sonnet_5_5.sql
-- Gate row for the film pipeline's new pinnable Script LLM, Claude Sonnet 5.5
-- (PIPELINE_PINNABLE_SCRIPT_LLMS in packages/shared/src/pipeline-types.ts —
-- the pipeline stages moved from Claude Sonnet 4.6 to Sonnet 5.5, 2026-10-16).
--
-- Same reason as migrations 274 and 498: create-pipeline.ts's tier guard passes
-- each pinned id verbatim to the credit check, and an identifier with no price
-- is a hard failure, so "pick this Script LLM" would not start a pipeline.
--
-- Gate-only value: this identifier is never deducted (the script stage's real
-- charge rides the generate-script / llm-chat feature identifiers). 20 is the
-- standard-tier value the claude-sonnet-4-6 row carries since migration 288,
-- and the one PINNABLE_SCRIPT_LLM_STATIC (ee/billing/credits.ts) derives from
-- the model's registry tier — keep the two in step.
--
-- The claude-sonnet-4-6 row stays: a pipeline saved with that pin keeps it.
--
-- ON CONFLICT DO NOTHING preserves any admin override set via /admin/models.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('claude-sonnet-5-5', 20, true, 'other')  -- standard tier
ON CONFLICT (model_identifier) DO NOTHING;
