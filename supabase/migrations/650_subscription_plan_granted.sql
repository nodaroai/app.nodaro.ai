-- A subscription grants its plan only once it is paid for.
--
-- Stripe creates a Checkout subscription `incomplete` while its first payment
-- is not done (a payment that needs the customer's action, a declined card)
-- and moves it to `active` once that invoice is paid, or to
-- `incomplete_expired` when it stays unpaid for 23 hours. The webhook granted
-- the plan (the paid tier, the plan's credits, its storage) the moment the
-- subscription was created, whatever its status. It now records an unpaid
-- subscription and grants it when an update first sees it active or trialing.
--
-- 1. subscriptions.plan_granted — whether this subscription's plan was
--    granted. The default is true, and that is deliberate: every row written
--    before this column existed was granted when it was created, and so is
--    every row inserted by a writer that does not name the column (the webhook
--    for a subscription paid at once, the self-heal and admin-repair upserts,
--    and the code still running until this deploys). Only the webhook's insert
--    of a not-yet-paid subscription writes false; the first update that sees
--    it active or trialing claims the grant by moving it to true, a
--    conditional update (`WHERE plan_granted = false`), so redelivered and
--    concurrent events grant it once. No backfill: the default marks the
--    existing rows, and re-running this file must never mark as granted a row
--    the webhook left ungranted.
--
-- 2. subscriptions.status also accepts `incomplete_expired`, the status Stripe
--    gives a subscription whose first payment never arrived (it was refused
--    by the CHECK, so such a row stayed `incomplete`).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the CHECK is dropped if it exists and
-- re-added (as migration 180 did).

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_granted BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.subscriptions.plan_granted IS
  'Whether the subscription''s plan (tier, credits, storage) was granted. False only while a subscription recorded unpaid has not yet been seen active or trialing.';

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled', 'incomplete', 'incomplete_expired', 'expired'));
