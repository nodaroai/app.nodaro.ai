-- Topaz Rhea on Video Upscale (decided 2026-11-24): a Video Upscale provider
-- priced per second of the clip by the target's size — 720p, 1080p or 4K.
-- Each row is the price of ONE second; a run is charged row × the clip's
-- exact length (counted in 1/64 s steps, rounded up), the total rounded up
-- once to a whole credit, and the hold is the charge. Values MUST match STATIC_CREDIT_COSTS
-- (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('topaz-rhea:720p:per-sec', 5, true, 'video'),
  ('topaz-rhea:1080p:per-sec', 10, true, 'video'),
  ('topaz-rhea:4k:per-sec', 30, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;

-- Nodaro Video Upscale, Transparent mode: its own rows, per second of the
-- clip by tier, billed at the clip's exact length. 2K is seeded at 4K's rate,
-- in a row of its own so it can be retuned on its own.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('nodaro-video-upscale:transparent:720p:per-sec', 5, true, 'video'),
  ('nodaro-video-upscale:transparent:1080p:per-sec', 10, true, 'video'),
  ('nodaro-video-upscale:transparent:2k:per-sec', 30, true, 'video'),
  ('nodaro-video-upscale:transparent:4k:per-sec', 30, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
