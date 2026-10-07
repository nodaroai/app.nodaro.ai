-- Pricing rows for the two post readers (Read Inspiration, Read Competitor).
-- Both are FREE: they read what the account already holds (its saved posts,
-- its tracked brands' scans). The rows exist so the admin pricing page lists
-- the nodes and STATIC_CREDIT_COSTS (0 for both) has its mirror, as the
-- migration-sync guard requires. Idempotent.

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('inspiration-read', 0) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('competitor-read', 0) ON CONFLICT (model_identifier) DO NOTHING;
