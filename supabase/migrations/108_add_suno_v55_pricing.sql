-- Add Suno V5.5 model pricing
INSERT INTO model_pricing (model_id, credit_cost, display_name, node_type, provider)
VALUES ('suno-v5_5', 4, 'Suno V5.5', 'suno-generate', 'suno')
ON CONFLICT (model_id) DO NOTHING;
