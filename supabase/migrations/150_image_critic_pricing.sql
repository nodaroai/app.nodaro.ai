-- Add image-critic to model_pricing.
-- Three rows: base (standard tier), economy, premium. Matches the
-- image-to-text + qa-check 3/5/15 pattern.
-- Per CLAUDE.md Provider Enum Sync step 9: ON CONFLICT DO NOTHING.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('image-critic',          5,  true, 'other'),
  ('image-critic:economy',  3,  true, 'other'),
  ('image-critic:premium', 15,  true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
