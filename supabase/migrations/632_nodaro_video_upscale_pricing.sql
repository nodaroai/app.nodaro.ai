-- Nodaro Video Upscale (decided 2026-11-11): a Video Upscale provider priced
-- per second of the clip — 3.75 / 7.5 / 15 base credits a second at 1080p /
-- 2K / 4K. A model_pricing row holds whole credits, so each tier's row is the
-- price of FOUR seconds; a run is charged row × billed seconds ÷ 4, rounded
-- up once, and the hold is the charge. Values MUST match STATIC_CREDIT_COSTS
-- (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('nodaro-video-upscale:1080p:per-4s', 15, true, 'video'),
  ('nodaro-video-upscale:2k:per-4s', 30, true, 'video'),
  ('nodaro-video-upscale:4k:per-4s', 60, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
