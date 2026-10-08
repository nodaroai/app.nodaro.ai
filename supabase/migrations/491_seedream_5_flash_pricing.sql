-- Seedream 5 Flash (KIE) — model pricing seed. Base credits (the admin markup
-- applies at read time), mirroring STATIC_CREDIT_COSTS and the MODEL_CATALOG
-- entries: one flat price per lane at every offered size (1K / 2K), so the
-- bare ids are the only rows — no composites. t2i and i2i are separate ids;
-- input images carry no surcharge. Idempotent.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('seedream-5-flash', 10, true, 'image'),
  ('seedream-5-flash-i2i', 10, true, 'image')
ON CONFLICT (model_identifier) DO NOTHING;
