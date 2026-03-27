-- Add node_states column to app_runs for persisting edited media results
ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS node_states JSONB DEFAULT NULL;

COMMENT ON COLUMN app_runs.node_states IS 'Overridden node states from user edits (merged over workflow_execution node_states)';
