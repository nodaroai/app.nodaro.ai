-- 100_veo3_lite_and_resolution_pricing.sql
-- Add VEO 3.1 Lite as a new i2v/t2v model variant, and seed composite
-- resolution-tiered pricing for veo3.1 + veo3_lite (720p base, 1080p
-- composite). 4K is via the separate /get-4k-video endpoint and stays
-- with the existing video-upscale node — not seeded here.
--
-- Per KIE pricing (verified 2026-05-06), seeded credits:
--   veo3.1 Fast 720p   → 19 credits
--   veo3.1 Fast 1080p  → 21 credits  ← NEW
--   veo3_lite 720p     → 10 credits  ← NEW
--   veo3_lite 1080p    → 11 credits  ← NEW
--
-- ON CONFLICT DO NOTHING preserves any admin overrides set via
-- /admin/models after the row first lands.

INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('veo3.1:1080p',    21, true, 'image-to-video'),
  ('veo3_lite',       10, true, 'image-to-video'),
  ('veo3_lite:1080p', 11, true, 'image-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
