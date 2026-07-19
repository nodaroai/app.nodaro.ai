-- Unified "Publish to Social" node — model_pricing row so the admin UI
-- (/admin/models) can see and override its price. Runtime already falls back
-- to STATIC_CREDIT_COSTS["publish-social"] = 1; this makes it DB-visible like
-- the 7 per-platform social nodes (seeded in migration 092).
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('publish-social', 1, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
