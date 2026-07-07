-- Admin /admin/models reads model_pricing exclusively; ON CONFLICT DO NOTHING
-- preserves any admin override. Value matches STATIC_CREDIT_COSTS
-- (credit-pricing-migration-sync.test.ts enforces this).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('voice-recast', 4, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;
