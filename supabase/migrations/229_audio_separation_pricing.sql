-- Seed model_pricing for the Audio Separation node (Demucs on Replicate).
-- Fixed reserved-tier pricing: 3 cr (Auto/Fast), 8 cr (Best / htdemucs_ft).
-- Admin /admin/models reads model_pricing exclusively; ON CONFLICT DO NOTHING
-- preserves any admin overrides. Base + composite values match
-- STATIC_CREDIT_COSTS (credit-pricing-migration-sync.test.ts enforces this).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('audio-separation',      3, true, 'audio'),
  ('audio-separation:best', 8, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
