-- Free tier: remove the 500-credit/day spending cap.
--
-- The enforced cap lives in code: FREE_TIER_RESTRICTIONS.dailyCreditCap (now
-- null = no cap) feeds both the TS preflight (checkCreditsWithProfile) and the
-- atomic reserve_credits() p_daily_limit parameter, where NULL already means
-- "no cap". This migration clears the tier_config mirror so everything that
-- reads the row — the legacy check_credits() SQL function, admin surfaces —
-- agrees with the code.
--
-- Free-tier exposure stays bounded by the one-time 1,500 signup grant
-- (profiles.subscription_credits DEFAULT, migration 295).

UPDATE tier_config SET daily_credit_limit = NULL WHERE tier = 'free';
