-- Seed model_pricing for the Audio FX node (FFmpeg audio effects: reverb/EQ/echo).
-- Flat 2 cr (no provider markup; mirrors mix-audio). Admin /admin/models reads
-- model_pricing exclusively; ON CONFLICT DO NOTHING preserves admin overrides.
-- Value matches STATIC_CREDIT_COSTS (credit-pricing-migration-sync.test.ts enforces this).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('audio-fx', 2, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
