-- Backfill profiles.current_period_end from subscriptions table
-- Webhook handlers now sync this field, but existing rows are stale

UPDATE profiles p
SET current_period_end = s.current_period_end
FROM subscriptions s
WHERE s.user_id = p.id
  AND s.status = 'active'
  AND s.current_period_end IS NOT NULL;
