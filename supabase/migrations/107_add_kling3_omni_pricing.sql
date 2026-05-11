-- Kling 3 Omni (Replicate) pricing migration
-- Costs are estimates based on comparable Replicate video models;
-- verified/adjusted after first production runs via audit-credits.

INSERT INTO model_pricing (model_identifier, credit_cost, description)
VALUES
  ('kling-3-omni',      32, 'Kling 3 Omni via Replicate — 5s 720p default'),
  ('kling-3-omni:5s',   32, 'Kling 3 Omni 5s (estimated ~$0.50)'),
  ('kling-3-omni:10s',  63, 'Kling 3 Omni 10s (estimated ~$1.00)'),
  ('kling-3-omni:15s',  94, 'Kling 3 Omni 15s (estimated ~$1.50)')
ON CONFLICT (model_identifier) DO NOTHING;
