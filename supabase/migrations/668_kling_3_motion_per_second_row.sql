-- Motion Transfer on Kling 3.0 at 720p is charged per second of its driving
-- video, as the server measures it (decided 2026-11-18): this row is the price
-- of FOUR seconds, and a run is charged row × billed seconds ÷ 4, rounded up
-- once — the hold is the charge. A model_pricing row holds whole credits, so
-- the row prices four seconds (the Nodaro Video Upscale precedent, migration
-- 632). Value MUST match STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- Only ADDS the row: the existing motion rows stay exactly as they are, since
-- the code running when this migration lands still charges them.
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('kling-3.0-motion:720p:per-4s', 228, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
