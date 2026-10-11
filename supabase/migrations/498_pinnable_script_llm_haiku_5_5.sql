-- 498_pinnable_script_llm_haiku_5_5.sql
-- Gate row for the film pipeline's new pinnable Script LLM, Claude Haiku 5.5
-- (PIPELINE_PINNABLE_SCRIPT_LLMS in packages/shared/src/pipeline-types.ts —
-- it replaced Claude Haiku 4.5 in the picker, decided 2026-10-10).
--
-- Same reason as migration 274: create-pipeline.ts's tier guard passes each
-- pinned id verbatim to the credit check, and an identifier with no price is a
-- hard failure, so "pick this Script LLM" would not start a pipeline.
--
-- Gate-only value: this identifier is never deducted (the script stage's real
-- charge rides the generate-script / llm-chat feature identifiers). 10 is the
-- economy value the other pinnable Script LLM rows carry since migration 288,
-- and the one PINNABLE_SCRIPT_LLM_STATIC (ee/billing/credits.ts) derives from
-- the model's registry tier — keep the two in step.
--
-- The claude-haiku-4-5 row stays: a pipeline saved with that pin keeps it.
--
-- ON CONFLICT DO NOTHING preserves any admin override set via /admin/models.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('claude-haiku-5-5', 10, true, 'other')  -- economy tier
ON CONFLICT (model_identifier) DO NOTHING;
