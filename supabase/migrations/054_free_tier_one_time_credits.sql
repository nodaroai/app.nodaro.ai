-- Free tier: 150 one-time credits (not monthly), 30/day cap
-- Update default for new users from 50 to 150
ALTER TABLE profiles ALTER COLUMN subscription_credits SET DEFAULT 150;
