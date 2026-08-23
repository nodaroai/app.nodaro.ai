-- ============================================================================
-- Organizations — E1 content scoping, part b of three: BACKFILLS AND TRIGGERS.
--
-- Nothing reads workspace_id yet; the rules that do arrive in part c. Every
-- trigger here is a no-op on today's data (workspace_id IS NULL on every row)
-- and the proof pins it as one. Three of the four functions are SECURITY
-- DEFINER so their inner statements are NOT filtered by the caller's RLS — as
-- INVOKER, a writer who cannot see the project would silently derive NULL and
-- the propagate function would skip rows it must not skip.
--
-- Every definer names pg_temp, and names it last. Left out, the temp schema is
-- searched FIRST for relation names, so a caller able to create a temporary
-- table shadows any table the function reads.
--
-- Re-applying this file is a no-op: OR REPLACE on every function, DROP TRIGGER
-- IF EXISTS before every CREATE TRIGGER, and backfills that select only rows
-- still needing the value.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Backfills.
--
-- The trigger guard is not optional. `set_updated_at` (001) fires on EVERY
-- workflow UPDATE and does `NEW.updated_at = NOW()` unconditionally, so an
-- unguarded backfill would rewrite updated_at on every workflow in the
-- database — the dashboard sorts by that column, so every user's list would
-- lose its ordering and show everything as touched at the same instant.
-- Demonstrated on the pinned Postgres image before this was written: without
-- the guard a workflow last edited in January reports the migration's own
-- timestamp; with it, the timestamp survives and created_by is still filled.
--
-- `bump_workflow_version` (218) needs no guard: it restores OLD.version unless
-- nodes/edges/settings/name change, and neither statement below touches those.
--
-- DISABLE/ENABLE is safe here: the migration runner wraps this file in one
-- transaction, so a failure rolls the DISABLE back with everything else, and
-- no other session sees the trigger off.
--
-- Lock note: ALTER TABLE ... DISABLE TRIGGER takes ACCESS EXCLUSIVE on
-- workflows and, like every lock, holds it until COMMIT — so the whole file
-- now runs under an exclusive lock on that table rather than only its
-- CREATE TRIGGER tail. The lock was needed either way and 821 rows take
-- milliseconds, but it queues every reader behind it while held, so run this
-- off-peak and do not let the backfill grow without revisiting the decision.
-- ---------------------------------------------------------------------------
ALTER TABLE workflows DISABLE TRIGGER set_updated_at;

UPDATE workflows SET created_by = user_id WHERE created_by IS NULL;
UPDATE workflows SET source_kind = 'template', source_id = template_id
 WHERE template_id IS NOT NULL AND source_kind IS NULL;

ALTER TABLE workflows ENABLE TRIGGER set_updated_at;

-- ---------------------------------------------------------------------------
-- The project decides the workspace — a workflow never carries its own answer.
-- Fires on INSERT and on UPDATE OF project_id OR workspace_id, and ALWAYS
-- overwrites, so a client-supplied workspace_id is discarded rather than
-- trusted.
--
-- SELECT ... INTO rather than INTO STRICT. The difference is unreachable
-- today and the comment says so on purpose: project_id is NOT NULL with a
-- foreign key, so the subquery returns exactly one row, always — STRICT would
-- have nothing to raise on, and a mutation test that flips it catches nothing.
-- The plain form is still the right one to write: it is correct if that column
-- ever becomes nullable, and it is what the surrounding comment describes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_workflow_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  SELECT workspace_id INTO NEW.workspace_id FROM projects WHERE id = NEW.project_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_workflow_workspace ON workflows;
CREATE TRIGGER trg_sync_workflow_workspace
  BEFORE INSERT OR UPDATE OF project_id, workspace_id ON workflows
  FOR EACH ROW EXECUTE FUNCTION sync_workflow_workspace();

-- ---------------------------------------------------------------------------
-- A project moving between workspaces re-stamps its workflows.
--
-- AFTER, reading NEW directly: a BEFORE-trigger self-update would read OLD and
-- no-op. The UPDATE it issues fires sync_workflow_workspace (UPDATE OF
-- workspace_id), which re-reads the same already-committed project row and
-- writes the same value — one extra pass, no loop.
--
-- Known and accepted: that UPDATE also fires set_updated_at, so the moved
-- project's workflows sort as recently updated. Moving a project between
-- workspaces changes what those workflows are, it is a rare deliberate act,
-- and a trigger cannot disable another trigger without an ACCESS EXCLUSIVE
-- lock it has no business taking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION propagate_project_workspace_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    UPDATE workflows SET workspace_id = NEW.workspace_id WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_propagate_project_workspace_change ON projects;
CREATE TRIGGER trg_propagate_project_workspace_change
  AFTER UPDATE OF workspace_id ON projects
  FOR EACH ROW EXECUTE FUNCTION propagate_project_workspace_change();

-- ---------------------------------------------------------------------------
-- Work done inside a workspace is never published to the public gallery.
--
-- Fires on UPDATE as well as INSERT because the workers rewrite is_public on
-- completion from the runner's profile, so an insert-only clamp would be
-- undone minutes later. force_private is the lever the workers actually
-- honour (render-worker, video-worker: a completed job with force_private
-- stays private however the profile is configured), so both are set.
--
-- Not SECURITY DEFINER: it touches NEW and reads no table.
--
-- The WHEN clause is what makes this affordable on the busiest table in the
-- system: the executor evaluates it without entering PL/pgSQL, so on today's
-- all-NULL data the per-row cost is one null test.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION clamp_workspace_job_privacy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_public := false;
  NEW.force_private := true;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clamp_workspace_job_privacy ON jobs;
CREATE TRIGGER trg_clamp_workspace_job_privacy
  BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW WHEN (NEW.workspace_id IS NOT NULL)
  EXECUTE FUNCTION clamp_workspace_job_privacy();

-- ---------------------------------------------------------------------------
-- Account deletion must not take the class's work with it.
--
-- Workspace-scoped workflows and projects are re-parented to the owning
-- organization's owner. Personal content is untouched and still cascades, as
-- it does today.
--
-- BOTH updates are required, and the one on projects is the load-bearing
-- half. profiles DELETE cascades to projects, and projects DELETE cascades to
-- workflows (001: both foreign keys are ON DELETE CASCADE). So re-parenting
-- the workflows alone saves nothing — the project would be deleted a moment
-- later and take them with it. Verified by removing the projects statement
-- alone: the WORKFLOW assertion is the one that fails.
--
-- jobs and usage_logs are deliberately NOT re-parented — run history for a
-- departed member's runs will show a gap, which is a documented limitation
-- rather than a silent promise.
--
-- workflow_templates is deliberately absent: its workspace_id is born two
-- epics from now, and PL/pgSQL resolves column names at first EXECUTION, so
-- naming it here would apply cleanly, pass every test, and then break account
-- deletion in production the first time anyone deleted an account.
--
-- Deleting an organization's owner is refused upstream by
-- organizations.owner_user_id ON DELETE RESTRICT, so the target of the
-- re-parent always exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reparent_workspace_content() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE workflows SET user_id = o.owner_user_id
    FROM organizations o, workspaces w
   WHERE workflows.workspace_id = w.id AND w.org_id = o.id AND workflows.user_id = OLD.id;
  UPDATE projects SET user_id = o.owner_user_id
    FROM organizations o, workspaces w
   WHERE projects.workspace_id = w.id AND w.org_id = o.id AND projects.user_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_reparent_workspace_content ON profiles;
CREATE TRIGGER trg_reparent_workspace_content
  BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION reparent_workspace_content();
