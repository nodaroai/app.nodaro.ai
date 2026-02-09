-- Kling 3.0 model pricing seed
-- Run in Supabase SQL Editor (idempotent via ON CONFLICT)

INSERT INTO model_pricing (model_identifier, display_name, credit_cost, our_cost, markup, is_enabled, provider, category)
VALUES
  ('kling-3.0', 'Kling 3.0 Video', 10, 0.50, 0.25, true, 'KIE.ai', 'video')
ON CONFLICT (model_identifier) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  credit_cost  = EXCLUDED.credit_cost,
  our_cost     = EXCLUDED.our_cost,
  markup       = EXCLUDED.markup,
  is_enabled   = EXCLUDED.is_enabled,
  provider     = EXCLUDED.provider,
  category     = EXCLUDED.category;
