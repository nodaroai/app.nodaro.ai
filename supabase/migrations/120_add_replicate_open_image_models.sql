-- Migration: seed model_pricing rows for Replicate "Open" (uncensored) image models
--
-- These models run through Replicate directly (not KIE.ai) and are exposed with
-- an "(Open)" suffix in the editor to signal they don't pass through KIE's
-- safety filter. STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts is the
-- runtime fallback; the admin UI reads pricing exclusively from this table.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  -- BFL Flux 2 9B Klein (text-to-image via black-forest-labs/flux-2-klein-9b)
  ('flux-2-klein',  2, true, 'generate-image'),

  -- Multi-image Flux Kontext Pro via flux-kontext-apps/multi-image-kontext-pro
  -- Available in both image-to-image and modify-image (i2i providers union)
  ('kontext-multi', 4, true, 'image-to-image')

ON CONFLICT (model_identifier) DO NOTHING;
