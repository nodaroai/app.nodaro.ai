-- Mask Outline (decided 2026-11-01): an internal step of a trend face mask's
-- role outlines — a coloured ring drawn locally around each role's masked
-- person. ONE pricing unit = 5 s of the clip (`maskOutlineUnits`,
-- backend/src/lib/mask-outline-length.ts; refused past 300 s, Video Mask's
-- cap), the video-utility unit, as Mask Erase. Value MUST match
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('mask-outline', 10, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
