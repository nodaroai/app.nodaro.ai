-- Pricing rows for the two collection nodes (Save to Collection, Read
-- Collection). Both are FREE: the plan's caps (collections per account,
-- records per collection — @nodaro/shared COLLECTION_TIER_CAPS) bound them,
-- not credits. The rows exist so the admin pricing page lists the nodes and
-- STATIC_CREDIT_COSTS (0 for both) has its mirror, as the migration-sync
-- guard requires. Idempotent.

INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('collection-write', 0) ON CONFLICT (model_identifier) DO NOTHING;
INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('collection-read', 0) ON CONFLICT (model_identifier) DO NOTHING;
