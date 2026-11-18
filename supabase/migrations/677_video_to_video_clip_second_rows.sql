-- Video to Video on HappyHorse Edit and Wan 2.7 VideoEdit is charged by the
-- length of the clip it edits, as the server reads it before anything is held
-- (decided 2026-11-18). Each row is the price of FOUR seconds; a model_pricing
-- row holds whole credits, so the row prices four seconds (the Nodaro Video
-- Upscale precedent, migration 632). Values MUST match STATIC_CREDIT_COSTS
-- (static-costs-match-migrations.test.ts).
--
-- - HappyHorse Edit: row × started half-seconds of the clip ÷ 8, rounded up
--   once, at the size sent (720p unless the request names 1080p).
-- - Wan 2.7 VideoEdit: row × billed seconds of the clip it delivers ÷ 4,
--   rounded up once, never below its flat `wan-videoedit` row (720p is charged
--   at the 1080p row for now).
--
-- Only ADDS rows: `happyhorse-edit` and `wan-videoedit` stay exactly as they
-- are, since the code running when this migration lands still charges them.
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('happyhorse-edit:720p:per-4s', 560, true, 'video-to-video'),
  ('happyhorse-edit:1080p:per-4s', 960, true, 'video-to-video'),
  ('wan-videoedit:1080p:per-4s', 240, true, 'video-to-video')
ON CONFLICT (model_identifier) DO NOTHING;
