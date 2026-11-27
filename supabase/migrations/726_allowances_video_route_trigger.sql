-- 726 — public.deployment_user_allowances, alone in this file: new
-- headroom for a requester repays the ENFORCED routed debts it could not
-- cover, best effort (722 holds the function: the allowance always commits).
--
-- Locks: SHARE ROW EXCLUSIVE on deployment_user_allowances (a trigger is being attached), on a
-- first apply and on a re-run alike, held until the file commits, and no lock
-- on any other table: writes to deployment_user_allowances wait for it, reads do not. The
-- lock_timeout bounds the wait for it behind a long writer: a failed migration
-- that is simply run again, never writes queued behind it.
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE TRIGGER recover_video_allowance AFTER UPDATE OF granted_credits ON public.deployment_user_allowances FOR EACH ROW
  WHEN (NEW.granted_credits>OLD.granted_credits) EXECUTE FUNCTION public.recover_video_allowance();
