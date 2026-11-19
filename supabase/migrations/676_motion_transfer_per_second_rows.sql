-- Motion Transfer is charged per second of its driving video, as the server
-- reads it, on every model and size (decided 2026-11-18; Kling 3.0 at 720p got
-- its row in migration 668). Each row is the price of FOUR seconds, and a run
-- is charged row × billed seconds ÷ 4, rounded up once — the hold is the
-- charge. Wan Animate Move is charged at its 720p row whatever size it names.
-- Wan Animate keeps its flat row for the size as a floor: a run is charged the
-- larger of that row and its per-second price. Values MUST match
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- Only ADDS rows: the existing motion rows stay exactly as they are, since the
-- code running when this migration lands still charges them.
--
-- ON CONFLICT DO NOTHING keeps any admin override.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('motion-transfer:720p:per-4s', 126, true, 'video'),
  ('motion-transfer:1080p:per-4s', 203, true, 'video'),
  ('kling-3.0-motion:1080p:per-4s', 302, true, 'video'),
  ('wan-animate-replace:480p:per-4s', 60, true, 'video'),
  ('wan-animate-replace:580p:per-4s', 95, true, 'video'),
  ('wan-animate-replace:720p:per-4s', 125, true, 'video'),
  ('wan-animate-move:720p:per-4s', 125, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
