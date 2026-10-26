-- Mask Erase (decided 2026-10-26): an internal step of a trend face mask's
-- "erased" marks — the regions centred in a box, on its frames, dropped from a
-- mask video by local ffmpeg. ONE pricing unit = 5 s of the mask
-- (`maskEraseUnits`, backend/src/lib/mask-erase-length.ts), the video-utility
-- unit. Value MUST match STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('mask-erase', 10, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
