-- Seedance 2.5 Flash Extend (extend-video node, provider
-- seedance-2-5-flash-extend) is charged like Seedance 2.5 Extend: per second
-- of video it sends and adds (the source's last 10 seconds, or all of a
-- shorter source, plus the seconds added). Each resolution's row is the price
-- of TWO seconds; a run is the row x (seconds sent + seconds added) / 2,
-- rounded up once. 480p and 720p only. The same figures as
-- STATIC_CREDIT_COSTS (static-costs-match-migrations.test.ts).
--
-- ON CONFLICT DO NOTHING keeps any admin override, and makes a second run a
-- no-op.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('seedance-2-5-flash-extend:480p:per-2s', 58, true, 'video'),
  ('seedance-2-5-flash-extend:720p:per-2s', 128, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
