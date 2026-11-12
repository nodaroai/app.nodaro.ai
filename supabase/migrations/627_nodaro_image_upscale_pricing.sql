-- Nodaro Image Upscale: an image upscale at 1x, 2x, 4x or 8x, priced by the
-- OUTPUT's total pixels (@nodaro/render-rules nodaro-image-upscale-pricing.ts).
-- One row per tier, and the bare id: the hold a run reserves when its image's
-- size cannot be read before the run (the top tier's price), settled to the
-- delivered output's tier. The same figures as STATIC_CREDIT_COSTS
-- (static-costs-match-migrations.test.ts).
--
--   nodaro-image-upscale:2K  output up to  4,194,304 px (2048 x 2048)
--   nodaro-image-upscale:4K  output up to 16,777,216 px (4096 x 4096)
--   nodaro-image-upscale:8K  output up to 67,108,864 px (8192 x 8192)
--
-- ON CONFLICT DO NOTHING: an admin's reprice stays.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('nodaro-image-upscale:2K', 4, true, 'image'),
  ('nodaro-image-upscale:4K', 10, true, 'image'),
  ('nodaro-image-upscale:8K', 30, true, 'image'),
  ('nodaro-image-upscale', 30, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;
