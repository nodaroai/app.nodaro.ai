-- Fix model pricing from KIE credit audit (2026-03-17)
-- Formula: ceil(kieCredits / 4) at 0% markup
-- Source: actual KIE costTime values from production usage

-- ── UNDERPRICED ──

-- wan-animate-move: 2→26 (480p), 3→33 (580p), 4→41 (720p)
-- Actual KIE costs: 102 cr (480p), ~131 cr (580p), 161.5 cr (720p)
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

-- bytedance-pro: 8→18 (actual 70 KIE cr, was using old estimate of 30)
UPDATE model_pricing SET credit_cost = 18 WHERE model_identifier = 'bytedance-pro';

-- hailuo-2.3-pro: base 15→20, 6s 12→13, 10s 23→20
-- Actual KIE costs: ~50 cr (6s), 80 cr (10s)
UPDATE model_pricing SET credit_cost = 20 WHERE model_identifier = 'hailuo-2.3-pro';
UPDATE model_pricing SET credit_cost = 13 WHERE model_identifier = 'hailuo-2.3-pro:6s';
UPDATE model_pricing SET credit_cost = 20 WHERE model_identifier = 'hailuo-2.3-pro:10s';

-- seedance:12s: 11→15 (actual 60 KIE cr, was using estimate of 42)
UPDATE model_pricing SET credit_cost = 15 WHERE model_identifier = 'seedance:12s';

-- ── OVERPRICED ──

-- bytedance-pro-fast: 19→9 (actual 36 KIE cr, was using old estimate of 60)
UPDATE model_pricing SET credit_cost = 9 WHERE model_identifier = 'bytedance-pro-fast';
