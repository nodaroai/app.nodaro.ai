-- Face Swap (roop) model pricing
INSERT INTO model_pricing (model_identifier, credit_cost, label, category)
VALUES ('roop-face-swap', 16, 'Face Swap (Roop)', 'face-swap')
ON CONFLICT (model_identifier) DO NOTHING;
