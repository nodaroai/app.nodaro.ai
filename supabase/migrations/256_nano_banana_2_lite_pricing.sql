-- Nano Banana 2 Lite (KIE, Gemini 3.1 Flash-Lite Image) — model pricing seed.
-- 1K output only — no resolution lever, single flat identifier (t2i and i2i
-- bill the same id; input images carry no surcharge).

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('nano-banana-2-lite', 2, true, 'image')
ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;
