-- 115_workflows_realtime.sql — Enable Supabase Realtime on workflows
--
-- Surfaces UPDATE events to the open editor tab so external writers
-- (MCP / Film Director skill via update_workflow_json) can append nodes
-- and edges to the user's React Flow canvas without requiring a refresh.
--
-- The frontend subscription lives in
--   frontend/src/components/editor/workflow-editor/use-workflow-realtime-sync.ts
-- and applies an APPEND-ONLY diff of payload.new.{nodes,edges} vs the
-- live React Flow state. Existing nodes/edges are preserved so a user's
-- in-progress edits (drag positions, prompt edits, etc.) are never
-- clobbered by a Realtime event.
--
-- REPLICA IDENTITY FULL ensures Postgres includes the full OLD row in
-- UPDATE WAL events. Even though the v1 frontend only consumes
-- payload.new, FULL is required so the WAL emits the unchanged-row
-- TOAST data (Postgres otherwise omits unchanged TOAST values like our
-- large nodes/edges JSONB arrays, which would yield a payload missing
-- the very fields we need to diff). Cost: a few hundred bytes per
-- update — workflow rows are not high-velocity.
--
-- RLS continues to apply to Realtime subscriptions (Supabase enforces
-- the same policies on the broadcast). Users only receive events for
-- workflow rows they can SELECT, which is the desired behavior.
--
-- Idempotent: ALTER TABLE … REPLICA IDENTITY is no-op on re-run, and
-- ALTER PUBLICATION … ADD TABLE is wrapped in a DO block that swallows
-- the "relation is already member of publication" error so the migration
-- can be re-applied without manual intervention.

ALTER TABLE public.workflows REPLICA IDENTITY FULL;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workflows;
EXCEPTION
    WHEN duplicate_object THEN
        -- Already in the publication — safe to ignore.
        NULL;
END $$;
