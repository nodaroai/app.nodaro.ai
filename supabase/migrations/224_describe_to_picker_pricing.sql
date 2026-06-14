-- Seed model_pricing for the describe-to-picker node (flat 1cr across LLM
-- tiers). Admin /admin/models reads model_pricing exclusively; ON CONFLICT DO
-- NOTHING preserves any admin overrides. Base value matches STATIC_CREDIT_COSTS.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('describe-to-picker',          1, true, 'other'),
  ('describe-to-picker:economy',  1, true, 'other'),
  ('describe-to-picker:premium',  1, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
