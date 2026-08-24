-- ============================================================================
-- Organizations — E1 / P9: a workspace gets its landing project atomically.
--
-- Creating a workspace and creating the project new work lands in must be ONE
-- transaction. Two statements from the plugin route means a crash between them
-- leaves a workspace whose default_project_id is NULL, and every later "create
-- a workflow here with no project" has nowhere to go. The plugin cannot open a
-- transaction across two PostgREST calls, so this is an RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_workspace_with_project(
  p_org_id       uuid,
  p_name         text,
  p_slug         text,
  p_description  text,
  p_settings     jsonb,
  p_created_by   uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_workspace_id uuid;
  v_project_id   uuid;
BEGIN
  INSERT INTO workspaces (org_id, name, slug, description, settings, created_by)
  VALUES (p_org_id, p_name, p_slug, p_description, COALESCE(p_settings, '{}'::jsonb), p_created_by)
  RETURNING id INTO v_workspace_id;

  -- is_default stays FALSE, and that is load-bearing rather than tidy:
  -- uniq_default_project_per_user (migration 119) is UNIQUE on projects(user_id)
  -- WHERE is_default, with no workspace dimension. A TRUE here would collide
  -- with the creating admin's own personal default on the FIRST workspace, and
  -- with itself on the second. A workspace's landing project is identified
  -- only by workspaces.default_project_id.
  INSERT INTO projects (user_id, name, description, settings, workspace_id, is_default)
  VALUES (p_created_by, p_name, NULL, '{}'::jsonb, v_workspace_id, FALSE)
  RETURNING id INTO v_project_id;

  UPDATE workspaces SET default_project_id = v_project_id WHERE id = v_workspace_id;

  RETURN v_workspace_id;
END $fn$;

-- ---------------------------------------------------------------------------
-- service_role ONLY, with authenticated explicitly revoked.
--
-- This function creates a workspace with no authorization check of its own —
-- the plugin route does that before calling it (requireOrgRole admin, write).
-- Reachable by `authenticated`, it would be a "create a workspace in any
-- organization you can name" endpoint. Supabase grants `anon` through default
-- privileges, so REVOKE FROM PUBLIC alone would not be enough.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_workspace_with_project(uuid, text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_workspace_with_project(uuid, text, text, text, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_workspace_with_project(uuid, text, text, text, jsonb, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.create_workspace_with_project(uuid, text, text, text, jsonb, uuid) TO service_role;
