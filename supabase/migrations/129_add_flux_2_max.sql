-- Migration: seed model_pricing rows for BFL Flux 2 Max (Replicate, "Safety Tolerance")
--
-- Flux 2 Max is the bigger sibling of Flux 2 Pro. Runs through Replicate
-- (not KIE.ai) with safety_tolerance pinned to 5 (max for the family). The
-- distinguishing feature vs Pro: accepts up to 8 reference images
-- (image_prompt_1..8) instead of 4.
--
-- VARIABLE PRICING — cost scales with reference-image count, so we seed 9
-- composite identifiers covering the 0..8 ref range. The route's
-- buildCreditModelIdentifier picks `flux-2-max:Nref` based on the actual
-- reference image count at request time.
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts mirrors these
-- rows as the runtime fallback; the admin UI reads pricing exclusively from
-- this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('flux-2-max',       3,  true, 'generate-image'),  -- 0 refs
  ('flux-2-max:1ref',  5,  true, 'generate-image'),
  ('flux-2-max:2ref',  7,  true, 'generate-image'),
  ('flux-2-max:3ref',  9,  true, 'generate-image'),
  ('flux-2-max:4ref',  10, true, 'generate-image'),
  ('flux-2-max:5ref',  12, true, 'generate-image'),
  ('flux-2-max:6ref',  14, true, 'generate-image'),
  ('flux-2-max:7ref',  16, true, 'generate-image'),
  ('flux-2-max:8ref',  18, true, 'generate-image')

ON CONFLICT (model_identifier) DO NOTHING;
