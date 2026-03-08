-- Add run name (user-editable) and thumbnail support for app runs

-- Runner can name their runs
ALTER TABLE app_runs ADD COLUMN IF NOT EXISTS name TEXT;

-- App creator can designate a node whose output serves as the run thumbnail
ALTER TABLE published_apps ADD COLUMN IF NOT EXISTS thumbnail_node_id TEXT;

-- Allow runners to update their own runs (for renaming)
CREATE POLICY "Runner can update own runs"
  ON app_runs FOR UPDATE
  USING (runner_id = auth.uid())
  WITH CHECK (runner_id = auth.uid());
