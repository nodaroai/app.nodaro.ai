-- 221_veo_4k_direct_generation_pricing.sql
-- VEO 3.1 direct-4K generation pricing.
--
-- "4K" becomes a resolution option on the VEO generate path: the base video is
-- generated at 1080p, then chained through KIE's get-4k-video endpoint
-- (runVeo4kTask) to produce the 4K result — all within one job.
--
-- Base cost, NO markup baked in (the admin panel applies markup centrally).
-- KIE credit → our credit = ceil(KIE_cr / 4), consistent with the existing VEO
-- generation rows (veo3 = 63 = 250/4). Source: docs.kie.ai VEO 3.1 + KIE pricing
-- announcement 2026-06.
--   veo3 (Quality) 4K = 370 KIE cr / $1.85 → 93 credits
--   veo3.1 (Fast)  4K = 180 KIE cr / $0.90 → 45 credits
--   veo3_lite      4K = 150 KIE cr / $0.75 → 38 credits
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via the admin panel.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('veo3:4k',      93, true, 'image-to-video'),
  ('veo3.1:4k',    45, true, 'image-to-video'),
  ('veo3_lite:4k', 38, true, 'image-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
