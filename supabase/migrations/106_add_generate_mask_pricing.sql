-- Generate Mask (Grounded SAM) model pricing
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('generate-mask', 2, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;
