-- Seedream 5.0 Pro (KIE) — model pricing seed.
-- Quality-tiered composites (same lever as the rest of the Seedream family):
--   basic (1K output) = 3 credits, high (2K output) = 6 credits, t2i and i2i alike.
-- I2I input images carry a small per-image provider surcharge, absorbed in the
-- flat tier price (family convention — no per-ref composite grid).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('seedream-5-pro',          3, true, 'image'),
  ('seedream-5-pro:high',     6, true, 'image'),
  ('seedream-5-pro-i2i',      3, true, 'image'),
  ('seedream-5-pro-i2i:high', 6, true, 'image')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
