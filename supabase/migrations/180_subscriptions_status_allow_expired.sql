-- subscriptions.status: allow 'expired'.
--
-- The hourly expireSubscriptions safety-net (ee/billing/cleanup-service.ts)
-- flips a canceled, past-period subscription to status = 'expired', but the
-- CHECK constraint (migration 024) only permits
-- active/trialing/past_due/paused/canceled/incomplete — so the UPDATE was
-- rejected (Postgres 23514), silently (error unchecked). The profile downgrade
-- still succeeded, but the subscription row stayed 'canceled' and was re-matched
-- every hour forever. Add 'expired' so the intended terminal flip succeeds and
-- the rows stop re-matching. Idempotent (drop-if-exists + re-add).

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled', 'incomplete', 'expired'));
