-- Extend Video's Grok price rows (extend-video node, provider grok-extend).
-- Grok extends only its own clips, by 6 or 10 seconds, and bills the seconds
-- it adds at the source's resolution: one row per length added (6 s, 10 s)
-- and source resolution (480p, 720p), the same figures as
-- STATIC_CREDIT_COSTS. No bare id.
--
-- ON CONFLICT DO NOTHING: an admin's reprice stays.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('grok-extend:6s:480p', 40, true, 'video'),
  ('grok-extend:6s:720p', 70, true, 'video'),
  ('grok-extend:10s:480p', 60, true, 'video'),
  ('grok-extend:10s:720p', 120, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
