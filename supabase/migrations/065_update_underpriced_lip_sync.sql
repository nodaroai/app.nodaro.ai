-- Update underpriced lip-sync models (per-second KIE billing at ~14s avg duration)
-- kling-avatar:     13 → 28 credits
-- kling-avatar-pro: 25 → 56 credits
-- infinitalk:       19 → 32 credits

UPDATE model_pricing SET credit_cost = 28 WHERE model_identifier = 'kling-avatar';
UPDATE model_pricing SET credit_cost = 56 WHERE model_identifier = 'kling-avatar-pro';
UPDATE model_pricing SET credit_cost = 32 WHERE model_identifier = 'infinitalk';
