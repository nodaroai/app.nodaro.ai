-- Telegram Channel Feed node — model_pricing row so the admin UI (/admin/models)
-- can see and override its price. Runtime falls back to
-- STATIC_CREDIT_COSTS["telegram-channel-feed"].
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('telegram-channel-feed', 1, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
