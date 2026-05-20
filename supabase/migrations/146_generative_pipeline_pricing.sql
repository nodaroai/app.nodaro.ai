-- 146_generative_pipeline_pricing.sql
-- Seed the model_pricing row for the Story → Video editor node
-- (node-type slug: 'generative-pipeline'). The editor's config panel +
-- node-toolbar call POST /v1/credits/model-costs with this slug to show
-- the credit estimate next to the node; without a row here the lookup
-- throws PriceNotConfiguredError → 503. The actual per-run cost is
-- computed dynamically by estimateUpfrontCredits (duration × format ×
-- mode), so this row is a UI display fallback only — it's NOT the value
-- charged at run time. Mirrors the existing 'pipeline-orchestration'
-- entry (the runtime identifier the engine uses) at 30 credits.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('generative-pipeline', 30, true, 'pipeline-orchestration')
ON CONFLICT (model_identifier) DO NOTHING;
