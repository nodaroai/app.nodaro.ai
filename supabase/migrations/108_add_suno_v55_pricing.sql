-- Add Suno V5.5 model pricing
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('suno-v5_5', 4, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
