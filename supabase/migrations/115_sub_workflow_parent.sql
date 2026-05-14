-- 115_sub_workflow_parent.sql
-- Adds parent_workflow_id so child workflows created from inside another
-- workflow can be hidden from project-level workflow lists.
-- NULL = top-level (current behavior preserved for all existing rows).

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS parent_workflow_id UUID
  REFERENCES workflows(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_workflows_parent_workflow_id
  ON workflows(parent_workflow_id)
  WHERE parent_workflow_id IS NOT NULL;

-- The list-by-project query becomes
--   ... WHERE project_id = $1 AND user_id = $2 AND parent_workflow_id IS NULL ...
-- so a composite partial index speeds that path.
CREATE INDEX IF NOT EXISTS idx_workflows_project_top_level
  ON workflows(project_id, user_id, created_at DESC)
  WHERE parent_workflow_id IS NULL;

COMMENT ON COLUMN workflows.parent_workflow_id IS
  'Set when this workflow was auto-created as a sub-workflow from inside another workflow. NULL for standalone/top-level workflows. Standalone workflows referenced by a sub-workflow node (existing flow) keep parent_workflow_id = NULL so they remain user-visible in the workflow list.';
