-- Fix model pricing from credit audit
-- kling i2v: 18→28 (underpriced -35%, 110 KIE cr at 10s avg)
-- infinitalk: 32→34 (underpriced -6%)
-- suno V4: 7→4 (overpriced +133%)
-- suno-v5: 13→4 (overpriced +333%)
-- suno-generate/cover/extend: 7→4 (same as suno V4)
-- qwen: 2→1 (overpriced +300%)

UPDATE model_pricing SET credit_cost = 28 WHERE model_identifier = 'kling';
-- infinitalk: variable pricing by resolution
UPDATE model_pricing SET credit_cost = 42 WHERE model_identifier = 'infinitalk';
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, tier_restriction)
VALUES
  ('infinitalk:480p', 11, true, null),
  ('infinitalk:720p', 42, true, null)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'suno';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'suno-v5';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'suno-generate';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'suno-cover';
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'suno-extend';
UPDATE model_pricing SET credit_cost = 1 WHERE model_identifier = 'qwen';
