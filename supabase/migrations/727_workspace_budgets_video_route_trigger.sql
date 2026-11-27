-- 727 — public.workspace_budgets, alone in this file: a new allocation
-- repays the workspace's ENFORCED routed debts, best effort and never past the
-- budget's headroom (722 holds the function: the allocation always commits).
--
-- Locks: SHARE ROW EXCLUSIVE on workspace_budgets (a trigger is being attached), on a
-- first apply and on a re-run alike, held until the file commits, and no lock
-- on any other table: writes to workspace_budgets wait for it, reads do not. The
-- lock_timeout bounds the wait for it behind a long writer: a failed migration
-- that is simply run again, never writes queued behind it.
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE TRIGGER recover_video_workspace_allocation BEFORE UPDATE OF allocated_credits ON public.workspace_budgets FOR EACH ROW
  WHEN (NEW.allocated_credits>OLD.allocated_credits) EXECUTE FUNCTION public.recover_video_workspace_allocation();
