-- Face Swap (roop) model pricing
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('roop-face-swap', 16, true, 'face-swap')
ON CONFLICT (model_identifier) DO NOTHING;
