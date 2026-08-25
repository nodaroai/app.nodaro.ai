-- Migration 349: mark the workflows the copilot handshake created (#904).
--
-- `POST /v1/copilot/threads { prompt }` inserts a workflow BEFORE the thread
-- and nothing rolls it back, so any failure after that point — a 402 on the
-- first turn, a dropped stream, the tab closed mid-hop, the handoff's own read
-- failing — leaves an empty workflow in the user's default project, named
-- after the first 60 characters of what they typed. Nobody asked for it, it
-- does nothing, and it sits at the top of the dashboard because it is the most
-- recently updated.
--
-- The sweep that removes it needs to know one thing the row cannot otherwise
-- say: was this workflow made BY the handshake, or did the user open the
-- copilot on a workflow they already had? Both produce a thread. Only the
-- first is ours to delete. Inferring it (from `source_prompt`, or from
-- timestamps being close) would drift the first time either changes — so the
-- creating code records the fact.
ALTER TABLE public.copilot_threads
  ADD COLUMN IF NOT EXISTS created_workflow boolean NOT NULL DEFAULT false;

-- The sweep's whole working set. Both predicates are mutable and that is the
-- point: a thread that produces its first turn leaves this index for good.
CREATE INDEX IF NOT EXISTS copilot_threads_seeded_unused
  ON public.copilot_threads (created_at)
  WHERE created_workflow AND user_turn_count = 0;
