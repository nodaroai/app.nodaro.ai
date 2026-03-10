-- Motion Transfer: duration-tiered pricing
-- Per-second billing: Kling 3.0 (12/20 cr/sec), Kling 2.6 (6/9 cr/sec)
-- Default tier = 10s when video duration is unknown

-- Update existing flat entries to 10s default tier values
UPDATE model_pricing SET credit_cost = 38 WHERE model_identifier = 'kling-3.0-motion';
UPDATE model_pricing SET credit_cost = 63 WHERE model_identifier = 'kling-3.0-motion:1080p';
UPDATE model_pricing SET credit_cost = 19 WHERE model_identifier = 'motion-transfer';

-- Insert all 16 duration-tiered entries
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  -- Kling 3.0 720p (12 KIE cr/sec)
  ('kling-3.0-motion:5s', 19, true),
  ('kling-3.0-motion:10s', 38, true),
  ('kling-3.0-motion:15s', 57, true),
  ('kling-3.0-motion:30s', 113, true),
  -- Kling 3.0 1080p (20 KIE cr/sec)
  ('kling-3.0-motion:1080p:5s', 32, true),
  ('kling-3.0-motion:1080p:10s', 63, true),
  ('kling-3.0-motion:1080p:15s', 94, true),
  ('kling-3.0-motion:1080p:30s', 188, true),
  -- Kling 2.6 720p (6 KIE cr/sec)
  ('motion-transfer:5s', 10, true),
  ('motion-transfer:10s', 19, true),
  ('motion-transfer:15s', 29, true),
  ('motion-transfer:30s', 57, true),
  -- Kling 2.6 1080p (9 KIE cr/sec)
  ('motion-transfer:1080p', 29, true),
  ('motion-transfer:1080p:5s', 15, true),
  ('motion-transfer:1080p:10s', 29, true),
  ('motion-transfer:1080p:15s', 43, true),
  ('motion-transfer:1080p:30s', 85, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
