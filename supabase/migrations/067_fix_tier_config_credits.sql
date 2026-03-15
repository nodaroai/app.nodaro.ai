-- Fix tier_config monthly_credits to match actual plan values
-- Old values were from an earlier pricing structure

UPDATE tier_config SET monthly_credits = 250 WHERE tier = 'basic';
UPDATE tier_config SET monthly_credits = 850 WHERE tier = 'standard';
UPDATE tier_config SET monthly_credits = 2000 WHERE tier = 'pro';
UPDATE tier_config SET monthly_credits = 4800 WHERE tier = 'business';

-- Reset subscription_credits for active paid users to match their tier allocation
-- (fixes users whose credits were set from the old tier_config values)
UPDATE profiles p
SET subscription_credits = tc.monthly_credits
FROM tier_config tc
WHERE p.tier = tc.tier
  AND p.tier != 'free'
  AND p.subscription_credits < tc.monthly_credits;
