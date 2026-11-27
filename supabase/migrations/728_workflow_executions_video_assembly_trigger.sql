-- 728 — public.workflow_executions, alone in this file: an execution's
-- saved clip address follows a background assembly that replaced it (722
-- holds the function; it reads a jobs column that 723 adds, so this file
-- comes after it).
--
-- Locks: SHARE ROW EXCLUSIVE on workflow_executions (a trigger is being attached), on a
-- first apply and on a re-run alike, held until the file commits, and no lock
-- on any other table: writes to workflow_executions wait for it, reads do not. The
-- lock_timeout bounds the wait for it behind a long writer: a failed migration
-- that is simply run again, never writes queued behind it.
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE TRIGGER file_recovered_execution_videos BEFORE INSERT OR UPDATE OF node_states ON public.workflow_executions
  FOR EACH ROW WHEN (NEW.node_states @? '$.*.output.clipJobId' OR NEW.node_states @? '$.*.output.listResultStamps[*].clipJobId')
  EXECUTE FUNCTION public.file_recovered_execution_videos();
