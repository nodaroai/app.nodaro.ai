-- Migration: seed model_pricing row for BFL Flux 2 Pro (Replicate, "Safety Tolerance")
--
-- Flux 2 Pro runs through Replicate (not KIE.ai) and exposes a `safety_tolerance`
-- parameter pinned to 5 (the max — Replicate caps Pro at 5, NOT 6) in the
-- provider buildInput. This lets the model produce content KIE's safety filter
-- would reject. Available in both generate-image and image-to-image categories —
-- accepts up to 4 reference images via `image_prompt_1..4`.
--
-- STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the runtime
-- fallback; the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- BFL Flux 2 Pro via black-forest-labs/flux-2-pro
  -- Available in both Generate Image (t2i) and Modify Image (i2i with refs).
  ('flux-2-pro', 4, true, 'generate-image')

ON CONFLICT (model_identifier) DO NOTHING;
