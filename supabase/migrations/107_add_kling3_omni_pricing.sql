-- Kling 3 Omni (Replicate) pricing migration
-- Costs are estimates based on comparable Replicate video models;
-- verified/adjusted after first production runs via audit-credits.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('kling-3-omni',      32, true, 'video'),
  ('kling-3-omni:5s',   32, true, 'video'),
  ('kling-3-omni:10s',  63, true, 'video'),
  ('kling-3-omni:15s',  94, true, 'video')
ON CONFLICT (model_identifier) DO NOTHING;
