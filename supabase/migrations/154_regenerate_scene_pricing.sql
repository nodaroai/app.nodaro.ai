-- 154_regenerate_scene_pricing.sql
-- Seed the model_pricing row for the Phase-2 "Regenerate this scene"
-- button in ScriptPanel. The route `/v1/pipelines/:id/stages/script/refine`
-- reserves credits against this identifier via creditGuard before calling
-- the Showrunner refine LLM (one Sonnet 4.6 call emitting a single
-- SceneSpec, ~$0.015 actual cost + buffer → 3 credits).
--
-- Without this row the admin UI (/admin/models) can't surface or override
-- the price — the runtime fallback in STATIC_CREDIT_COSTS (3 credits) would
-- still charge correctly, but the price would be invisible to admins.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('regenerate-scene', 3, true, 'pipeline-llm')
ON CONFLICT (model_identifier) DO NOTHING;
