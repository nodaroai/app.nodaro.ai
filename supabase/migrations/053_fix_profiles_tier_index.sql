-- Migration 053: Fix profiles tier index
-- Migration 052 indexed profiles(tier) but the FK fk_subscription_tier
-- is on the subscription_tier column. Add the correct index.

DROP INDEX IF EXISTS idx_profiles_subscription_tier;
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier ON profiles (subscription_tier);
