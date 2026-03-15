-- Duration-tiered pricing for video models
-- Models previously charged flat rates now use composite identifiers based on duration

-- Kling 2.6 (5s/10s, with audio addon)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('kling:5s', 14, true),
  ('kling:10s', 28, true),
  ('kling:5s:audio', 28, true),
  ('kling:10s:audio', 56, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Kling Turbo (5s/10s)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('kling-turbo:5s', 11, true),
  ('kling-turbo:10s', 22, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Kling Master (5s/10s)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('kling-master:5s', 40, true),
  ('kling-master:10s', 80, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Grok I2V (6s/10s/15s, shared with grok T2V)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('grok-i2v:6s', 5, true),
  ('grok-i2v:10s', 8, true),
  ('grok-i2v:15s', 10, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Wan I2V (5s/10s/15s, 720p default)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('wan-i2v:5s', 18, true),
  ('wan-i2v:10s', 35, true),
  ('wan-i2v:15s', 53, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Hailuo 2.3 Pro (6s/10s)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('hailuo-2.3-pro:6s', 12, true),
  ('hailuo-2.3-pro:10s', 23, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Hailuo 2.3 (6s/10s)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('hailuo-2.3:6s', 8, true),
  ('hailuo-2.3:10s', 13, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Hailuo Standard (6s/10s)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('hailuo-standard:6s', 8, true),
  ('hailuo-standard:10s', 13, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Sora2 Pro (5s/10s, standard vs high quality mode)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('sora2-pro:5s', 38, true),
  ('sora2-pro:10s', 68, true),
  ('sora2-pro:5s:high', 83, true),
  ('sora2-pro:10s:high', 158, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Sora2 (5s/10s)
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled) VALUES
  ('sora2:5s', 8, true),
  ('sora2:10s', 9, true)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- Update sora2-pro base cost (was 47, now 38 for standard 5s default)
UPDATE model_pricing SET credit_cost = 38 WHERE model_identifier = 'sora2-pro';
