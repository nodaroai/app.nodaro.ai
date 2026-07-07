-- Fix model pricing from KIE credit audit (2026-03-17)
-- Re-priced against a provider billing audit (0% markup)
-- Source: actual provider cost values from production usage

-- ── UNDERPRICED ──

-- wan-animate-move: 2→26 (480p), 3→33 (580p), 4→41 (720p)
-- Re-priced to match actual measured usage vs. the original estimate
UPDATE model_pricing SET credit_cost = 26 WHERE model_identifier = 'wan-animate-move';
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, tier_restriction)
VALUES
  ('wan-animate-move:580p', 33, true, null),
  ('wan-animate-move:720p', 41, true, null)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- wan-animate-replace: same costs as wan-animate-move
UPDATE model_pricing SET credit_cost = 26 WHERE model_identifier = 'wan-animate-replace';
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, tier_restriction)
VALUES
  ('wan-animate-replace:580p', 33, true, null),
  ('wan-animate-replace:720p', 41, true, null)
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;

-- bytedance-pro: 8→18 (re-priced to match actual measured usage vs. the original estimate)
UPDATE model_pricing SET credit_cost = 18 WHERE model_identifier = 'bytedance-pro';

-- hailuo-2.3-pro: base 15→20, 6s 12→13, 10s 23→20
-- Re-priced to match actual measured usage vs. the original estimate
UPDATE model_pricing SET credit_cost = 20 WHERE model_identifier = 'hailuo-2.3-pro';
UPDATE model_pricing SET credit_cost = 13 WHERE model_identifier = 'hailuo-2.3-pro:6s';
UPDATE model_pricing SET credit_cost = 20 WHERE model_identifier = 'hailuo-2.3-pro:10s';

-- seedance:12s: 11→15 (re-priced to match actual measured usage vs. the original estimate)
UPDATE model_pricing SET credit_cost = 15 WHERE model_identifier = 'seedance:12s';

-- ── OVERPRICED ──

-- bytedance-pro-fast: 19→9 (re-priced to match actual measured usage vs. the original estimate)
UPDATE model_pricing SET credit_cost = 9 WHERE model_identifier = 'bytedance-pro-fast';
