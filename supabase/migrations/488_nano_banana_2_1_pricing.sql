-- Nano Banana 2.1 (KIE) — model pricing seed. Base credits (the admin markup
-- applies at read time), mirroring STATIC_CREDIT_COSTS and the MODEL_CATALOG
-- entry: 1K is the bare id, 2K / 4K are composites. t2i and i2i bill the same
-- ids; input images carry no surcharge. Idempotent.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('nano-banana-2-1', 10, true, 'image'),
  ('nano-banana-2-1:2K', 20, true, 'image'),
  ('nano-banana-2-1:4K', 30, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;
