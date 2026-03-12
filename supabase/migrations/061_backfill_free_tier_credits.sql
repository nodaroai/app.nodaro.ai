-- Backfill free tier users who were created before migration 054 changed the default from 50 to 150.
-- Only update users who:
--   1. Are on the free tier (no active subscription)
--   2. Have subscription_credits < 150 (haven't been manually topped up above 150)
--   3. Have no topup_credits (haven't purchased top-ups, which would mean they chose to spend)
--
-- For these users, add the difference (150 - current value) so they reach the intended 150 grant.
-- Users who already spent some of the original 50 get the missing 100 added back.

UPDATE profiles
SET subscription_credits = subscription_credits + (150 - 50)
WHERE tier = 'free'
  AND subscription_tier = 'free'
  AND subscription_credits < 150
  AND topup_credits = 0;
