-- 724 — public.usage_logs, alone in this file: the two triggers of an
-- unpaid routed charge (722 holds their functions). One refuses a new
-- paid reservation while the payer has an ENFORCED debt (none is, until an
-- admin turns enforcement on for an environment); the other clears a debt
-- whose charge was refunded.
--
-- Locks: SHARE ROW EXCLUSIVE on usage_logs (a trigger is being attached), on a
-- first apply and on a re-run alike, held until the file commits, and no lock
-- on any other table: writes to usage_logs wait for it, reads do not. The
-- lock_timeout bounds the wait for it behind a long writer: a failed migration
-- that is simply run again, never writes queued behind it.
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE TRIGGER block_unpaid_video_reservation BEFORE INSERT ON public.usage_logs FOR EACH ROW
  WHEN (NEW.status='reserved' AND NEW.credits_used>0) EXECUTE FUNCTION public.block_unpaid_video_reservation();

CREATE OR REPLACE TRIGGER clear_refunded_video_debt AFTER UPDATE OF status ON public.usage_logs FOR EACH ROW
  WHEN (OLD.status='committed' AND NEW.status='refunded' AND OLD.metadata ? 'videoRouteReceipt') EXECUTE FUNCTION public.clear_refunded_video_debt();
