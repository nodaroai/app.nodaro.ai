-- Migration 404: a copilot thread says WHICH assistant it belongs to.
--
-- Until now there was one: the canvas assistant, one live thread per (user,
-- workflow). A second assistant is coming — it sits inside the studio editor
-- and talks about the SAME workflow — and two live threads on one workflow is
-- exactly what the old index forbids. Worse than forbidding it: the read that
-- looks a thread up took a single row, so a workflow holding two live threads
-- made the lookup error, the error read as "no thread at all", and the caller
-- then tried to create a duplicate the index refused.
--
-- The column is the fact the row cannot otherwise state. Inferring it (from
-- the workflow's shape, from which route wrote it) would drift the first time
-- either changes.

-- The DEFAULT is the canvas surface, so every row already in the table — and
-- every insert written before this migration reached the database — is a
-- canvas thread, which is what they all are.
ALTER TABLE public.copilot_threads
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'workflow'
  CHECK (surface IN ('workflow', 'studio'));

-- The wider invariant, CREATED FIRST. The old index is the stricter of the
-- two (it admits one live thread per workflow whatever its surface), so no
-- existing row can violate this one and there is no moment in which a workflow
-- accepts two live threads of the same kind: the narrow index holds until the
-- wide one exists, and the wide one holds from then on.
CREATE UNIQUE INDEX IF NOT EXISTS copilot_threads_active_per_workflow_surface
  ON public.copilot_threads (user_id, workflow_id, surface)
  WHERE archived_at IS NULL;

-- …and only now the narrower one, which from here on would refuse the second
-- assistant's thread.
DROP INDEX IF EXISTS public.copilot_threads_active_per_workflow;
