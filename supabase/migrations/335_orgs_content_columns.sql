-- ============================================================================
-- Organizations — E1 content scoping, part a of three: COLUMNS ONLY.
--
-- Additive and unread. Nothing in the application or in any policy reads any
-- object created here until part c (the RLS rewrite), which lands as its own
-- migration after this one has run on production. Every statement is
-- idempotent (IF NOT EXISTS / OR REPLACE / a guarded DO block) so a re-apply
-- is a no-op.
--
-- `kind_preset` / `effective_setting` / `ws_setting_bool` are deliberately
-- NOT redefined here: 332 owns them, and its header forbids redefinition.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- projects: the workspace a project belongs to. NULL = the personal space.
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id) WHERE workspace_id IS NOT NULL;

-- workspaces.default_project_id -> projects. Guarded: 332 could not declare
-- the FK because its target column did not exist yet.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_workspaces_default_project' AND conrelid = 'workspaces'::regclass) THEN
    ALTER TABLE workspaces ADD CONSTRAINT fk_workspaces_default_project
      FOREIGN KEY (default_project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- workflows: scope (derived from the project — part b adds the trigger),
-- visibility, and provenance.
-- ---------------------------------------------------------------------------
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS workspace_id        uuid REFERENCES workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS visibility          text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','workspace')),
  ADD COLUMN IF NOT EXISTS created_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kind         text CHECK (source_kind IN ('template','workflow','app_remix','import','assignment')),
  ADD COLUMN IF NOT EXISTS source_id           uuid,
  ADD COLUMN IF NOT EXISTS original_author_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_id       uuid,
  ADD COLUMN IF NOT EXISTS last_edited_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_edited_at      timestamptz;
CREATE INDEX IF NOT EXISTS idx_workflows_workspace_updated ON workflows(workspace_id, updated_at DESC) WHERE workspace_id IS NOT NULL;
-- Every column that references profiles gets its own partial index: a profile
-- DELETE runs one UPDATE ... SET <col> = NULL per referencing column, and
-- without these each one is a sequential scan of the whole table.
CREATE INDEX IF NOT EXISTS idx_workflows_created_by      ON workflows(created_by)         WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflows_original_author ON workflows(original_author_id) WHERE original_author_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflows_last_edited_by  ON workflows(last_edited_by)     WHERE last_edited_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Stamp columns on the high-volume tables. Plain uuid, NO foreign key, on
-- purpose: the backend stamps these at insert time from an already-resolved
-- context, and an FK would put a lookup on the hottest insert path we have.
-- ---------------------------------------------------------------------------
ALTER TABLE jobs                ADD COLUMN IF NOT EXISTS workspace_id uuid, ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS workspace_id uuid, ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE usage_logs          ADD COLUMN IF NOT EXISTS workspace_id uuid, ADD COLUMN IF NOT EXISTS org_id uuid;

-- Of the ALTERs above, the one on workflows is the only one that scans under its
-- lock: adding a CHECK constraint verifies every existing row. The stamp-column
-- ALTERs below are catalog-only.
-- NOT CONCURRENTLY: the migration runner wraps each file in a transaction, so
-- CONCURRENTLY is unavailable (271_client_app_origin.sql made the same call for
-- the same reason). Every pre-existing row has a NULL workspace_id, so each
-- partial index indexes ZERO rows at apply time and the SHARE lock is held only
-- for the heap scan. Apply off-peak regardless; `jobs` is the busiest table.
CREATE INDEX IF NOT EXISTS idx_jobs_workspace_created               ON jobs(workspace_id, created_at DESC)               WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workspace_created ON workflow_executions(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_logs_workspace_created         ON usage_logs(workspace_id, created_at DESC)         WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_logs_org_created               ON usage_logs(org_id, created_at DESC)               WHERE org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- api_tokens: a personal token may be bound to one workspace. CASCADE: a token
-- bound to a workspace that no longer exists is meaningless.
-- ---------------------------------------------------------------------------
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_api_tokens_workspace ON api_tokens(workspace_id) WHERE workspace_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- workflow_collaborators: an explicit viewer/editor grant on one workflow,
-- independent of workspace membership. Read by the access rule in part c.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_collaborators (
  workflow_id  uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('viewer','editor')),
  added_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_collaborators_user     ON workflow_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_collaborators_added_by ON workflow_collaborators(added_by) WHERE added_by IS NOT NULL;

-- RLS ON with NO client policy: service-role only until the collaborator routes
-- add one. Without this, the default table grants make the table writable by
-- every signed-in user, and a row planted here becomes a live edit grant the
-- moment the access rule (part c) starts reading it.
ALTER TABLE workflow_collaborators ENABLE ROW LEVEL SECURITY;

-- The creator is not a collaborator: such a row would let the access rule
-- report 'edit' where it must report 'own'. SECURITY DEFINER so the lookup on
-- workflows is not filtered by the inserting user's own RLS — as INVOKER, a
-- caller who cannot see the target workflow would get EXISTS = false and the
-- guard would silently pass.
--
-- search_path lists pg_temp EXPLICITLY, and last. Left out, the temp schema is
-- searched FIRST for relation names, so a caller able to create a temporary
-- table named `workflows` shadows the lookup and the guard passes for every
-- row. Naming it puts it after public, where it can shadow nothing.
CREATE OR REPLACE FUNCTION reject_self_collaborator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workflows WHERE id = NEW.workflow_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'SELF_COLLABORATOR: the creator of a workflow cannot be its collaborator';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_reject_self_collaborator ON workflow_collaborators;
CREATE TRIGGER trg_reject_self_collaborator BEFORE INSERT OR UPDATE ON workflow_collaborators
  FOR EACH ROW EXECUTE FUNCTION reject_self_collaborator();
