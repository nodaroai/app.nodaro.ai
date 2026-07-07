-- Fix model pricing from credit audit (2026-03-16)
-- Re-priced against a provider billing audit (0% markup, matches app_settings.cost_markup_percent)

-- ── UNDERPRICED ──

-- elevenlabs-isolation: 1→4 (was estimated at ~10s audio; actual usage runs much longer, ~80s avg)
UPDATE model_pricing SET credit_cost = 4 WHERE model_identifier = 'elevenlabs-isolation';

-- grok-i2v duration tiers: revert to 0% formula (were correct before)
UPDATE model_pricing SET credit_cost = 5 WHERE model_identifier = 'grok-i2v:6s';
UPDATE model_pricing SET credit_cost = 8 WHERE model_identifier = 'grok-i2v:10s';
UPDATE model_pricing SET credit_cost = 10 WHERE model_identifier = 'grok-i2v:15s';

-- kling-turbo duration tiers: fix to 0% formula
UPDATE model_pricing SET credit_cost = 11 WHERE model_identifier = 'kling-turbo:5s';
UPDATE model_pricing SET credit_cost = 21 WHERE model_identifier = 'kling-turbo:10s';

-- ── OVERPRICED ──

-- seedance: 32→7 (re-priced from a flat per-generation estimate to actual per-second usage)
-- Add duration-tiered pricing
UPDATE model_pricing SET credit_cost = 7 WHERE model_identifier = 'seedance';
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, tier_restriction)
VALUES
  ('seedance:4s', 4, true, null),
  ('seedance:8s', 7, true, null),
  ('seedance:12s', 11, true, null)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- bytedance-lite: 16→6 (re-priced to match actual measured usage vs. the original estimate)
UPDATE model_pricing SET credit_cost = 6 WHERE model_identifier = 'bytedance-lite';

-- bytedance-pro: 22→8 (re-priced to match actual measured usage vs. the original estimate)
UPDATE model_pricing SET credit_cost = 8 WHERE model_identifier = 'bytedance-pro';
