-- ============================================================================
-- Organizations — E1 content scoping, part c of three: THE RULES.
--
-- Parts a and b were additive and unread. This one rewrites who may see and
-- change content, so it is the migration that can break the product for
-- everyone at once. Two things make it survivable:
--
--   * Every predicate keeps today's rule as its FIRST disjunct. `user_id =
--     auth.uid()` still means what it has always meant, and everything the
--     organizations work adds is strictly additional. On today's data — where
--     every workspace_id is NULL and no organization exists — the new
--     predicates evaluate to exactly the old ones.
--   * `supabase/reverts/338_orgs_content_rls_revert.sql` puts the eleven
--     original policies back, verbatim from 032 and 206.
--
-- Re-applying is a no-op: OR REPLACE on every function, and DROP POLICY IF
-- EXISTS before every CREATE POLICY — the NEW names included, because the CI
-- idempotency step re-applies this exact file over itself and CREATE POLICY
-- has no OR REPLACE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- access_rank FIRST. PL/pgSQL resolves names at first EXECUTION, so a
-- workflow_access that calls a not-yet-created access_rank would be created
-- happily and fail on its first call — in an RLS predicate, which means the
-- caller's whole query fails. Declaration order is load-bearing here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION access_rank(p text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'own' THEN 3 WHEN 'edit' THEN 2 WHEN 'view' THEN 1 ELSE 0 END;
$$;

-- ---------------------------------------------------------------------------
-- workflow_access: what may this caller do with this workflow.
--
-- The SQL twin of the plugin's `computeWorkflowAccess`. They are two
-- implementations of one rule and the parity job compares them cell by cell;
-- a change here without the same change there is not a bug in one place, it is
-- two different products.
--
--   'own' > 'edit' > 'view' > 'none'
--
-- Order matters and is the whole rule:
--   1. platform admin        -> own
--   2. suspended membership  -> none   (beats the creator and every grant)
--   3. creator               -> own    (view when the workspace is archived)
--   4. the STRONGER of the collaborator grant and the role-derived access.
--      A grant is a floor, never a ceiling: a viewer grant cannot downgrade an
--      admin who could edit anyway. A grant to someone who is NOT a member of
--      a workspace-scoped workflow's workspace is capped at view, editor or
--      not — an outsider may read the work, never bill the class for a run.
--
-- SECURITY DEFINER for two reasons, not one: the caller must not need rights
-- on workspaces / workflow_collaborators to be judged, AND the inner read of
-- `workflows` must bypass RLS — otherwise the SELECT policy that calls this
-- function would call it again, forever.
--
-- EXCEPTION ... RETURN 'none' is fail-closed on purpose. This runs inside RLS
-- USING clauses, where a raise does not deny one row, it fails the caller's
-- entire query. The cost is a subtransaction per call; at this table size that
-- is the right trade, and if it ever stops being one the answer is to narrow
-- what the policies call, not to remove the catch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workflow_access(p_workflow_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      uuid := COALESCE(auth.uid(), p_user_id);
  v_wf       record;
  v_role     text;
  v_status   text;
  v_archived boolean := false;
  v_grant    text;
  v_granted  text := 'none';
  v_derived  text := 'none';
  v_best     text;
BEGIN
  IF v_uid IS NULL THEN RETURN 'none'; END IF;
  IF is_admin() THEN RETURN 'own'; END IF;

  SELECT w.user_id, w.workspace_id, w.visibility INTO v_wf
    FROM workflows w WHERE w.id = p_workflow_id;
  IF NOT FOUND THEN RETURN 'none'; END IF;

  IF v_wf.workspace_id IS NOT NULL THEN
    v_role   := workspace_role(v_wf.workspace_id, v_uid);
    v_status := workspace_member_status(v_wf.workspace_id, v_uid);
    IF v_role IS NOT NULL AND v_status = 'suspended' THEN RETURN 'none'; END IF;
    SELECT (archived_at IS NOT NULL) INTO v_archived FROM workspaces WHERE id = v_wf.workspace_id;
    v_archived := COALESCE(v_archived, false);
  END IF;

  IF v_wf.user_id = v_uid THEN
    RETURN CASE WHEN v_archived THEN 'view' ELSE 'own' END;
  END IF;

  SELECT role INTO v_grant FROM workflow_collaborators
   WHERE workflow_id = p_workflow_id AND user_id = v_uid;
  IF v_grant IS NOT NULL THEN
    v_granted := CASE
      WHEN v_wf.workspace_id IS NOT NULL AND v_role IS NULL THEN 'view'   -- non-member: never edit
      WHEN v_grant = 'editor' THEN 'edit'
      ELSE 'view' END;
  END IF;

  IF v_wf.workspace_id IS NOT NULL AND v_role IS NOT NULL THEN
    IF v_role = 'admin' THEN
      v_derived := COALESCE(effective_setting(v_wf.workspace_id, 'admin_access') #>> '{}', 'none');
    ELSIF v_wf.visibility = 'workspace' THEN
      v_derived := COALESCE(effective_setting(v_wf.workspace_id, 'member_access_to_shared') #>> '{}', 'none');
    END IF;
  END IF;

  v_best := CASE WHEN access_rank(v_granted) >= access_rank(v_derived) THEN v_granted ELSE v_derived END;
  IF v_best = 'none' THEN RETURN 'none'; END IF;
  RETURN CASE WHEN v_archived THEN 'view' ELSE v_best END;
EXCEPTION WHEN OTHERS THEN
  RETURN 'none';
END $$;

-- ---------------------------------------------------------------------------
-- Column pinning for client UPDATEs.
--
-- Postgres RLS has no OLD/NEW: inside WITH CHECK the table reference is the
-- CANDIDATE row only. So `check(workflows.*, workflows.*)` compares the new row
-- to itself and is always true — a silent no-op that makes the rewritten UPDATE
-- policy strictly WIDER than the one it replaces. The only form that works is
-- this one, which 310_auto_recharge.sql established: the policy passes the NEW
-- values as scalars, and the body re-reads the OLD row by primary key, which
-- the statement's own snapshot still shows unchanged.
--
-- Pinned for EVERYONE on the client path. No admin exemption: the admin routes
-- use the service role, which bypasses RLS and therefore this check entirely.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_workflows_update_allowed(
  p_id uuid, p_user_id uuid, p_created_by uuid, p_original_author_id uuid,
  p_source_kind text, p_source_id uuid, p_assignment_id uuid,
  p_visibility text, p_project_id uuid, p_share_token text, p_is_presentation_enabled boolean
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_row workflows%ROWTYPE;
BEGIN
  SELECT * INTO old_row FROM workflows WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Never changeable by a client, whoever they are: ownership and provenance.
  IF p_user_id            IS DISTINCT FROM old_row.user_id OR
     p_created_by         IS DISTINCT FROM old_row.created_by OR
     p_original_author_id IS DISTINCT FROM old_row.original_author_id OR
     p_source_kind        IS DISTINCT FROM old_row.source_kind OR
     p_source_id          IS DISTINCT FROM old_row.source_id OR
     p_assignment_id      IS DISTINCT FROM old_row.assignment_id
  THEN RETURN false; END IF;

  -- Changeable, but only by someone who owns the workflow or administers its
  -- workspace: visibility, which project it lives in, and the public-sharing
  -- levers. An editor may change the canvas, never who else can reach it.
  IF (p_visibility              IS DISTINCT FROM old_row.visibility OR
      p_project_id              IS DISTINCT FROM old_row.project_id OR
      p_share_token             IS DISTINCT FROM old_row.share_token OR
      p_is_presentation_enabled IS DISTINCT FROM old_row.is_presentation_enabled)
     AND workflow_access(old_row.id) <> 'own'
     AND NOT (old_row.workspace_id IS NOT NULL AND workspace_role(old_row.workspace_id) = 'admin')
  THEN RETURN false; END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION check_projects_update_allowed(
  p_id uuid, p_user_id uuid, p_workspace_id uuid, p_is_default boolean
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_row projects%ROWTYPE;
BEGIN
  SELECT * INTO old_row FROM projects WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  -- user_id, workspace_id and is_default never change through a client UPDATE.
  -- A project moves between workspaces only through the service-role route,
  -- where the move is authorized and recorded.
  IF p_user_id      IS DISTINCT FROM old_row.user_id OR
     p_workspace_id IS DISTINCT FROM old_row.workspace_id OR
     p_is_default   IS DISTINCT FROM old_row.is_default
  THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;

-- ---------------------------------------------------------------------------
-- apply_workflow_delta — the autosave path, and the hottest write in the
-- product. The ENTIRE function is restated from 219 with exactly one line
-- changed, so a reader can diff the two files and see the whole change.
--
-- Deliberately NOT added here: the `workflow_contributors` upsert and the
-- last_edited_by/at stamping. That table is created two epics from now, and
-- PL/pgSQL resolves column names at first EXECUTION — a reference to it would
-- apply cleanly, pass every test, and then fail the first autosave after
-- deploy, for every user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_workflow_delta(
    p_workflow_id uuid,
    p_base_version integer,
    p_upsert_nodes jsonb DEFAULT '[]'::jsonb,
    p_delete_node_ids text[] DEFAULT '{}'::text[],
    p_upsert_edges jsonb DEFAULT '[]'::jsonb,
    p_delete_edge_ids text[] DEFAULT '{}'::text[],
    p_set jsonb DEFAULT NULL,
    p_user_id uuid DEFAULT NULL
) RETURNS TABLE (ok boolean, version integer, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid;
    v_row public.workflows%ROWTYPE;
    v_nodes jsonb;
    v_edges jsonb;
    v_settings jsonb;
    v_name text;
    v_upsert_node_ids text[];
    v_upsert_edge_ids text[];
BEGIN
    v_uid := coalesce(auth.uid(), p_user_id);
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT false, NULL::integer, NULL::timestamptz;
        RETURN;
    END IF;

    -- The one changed line. Was: `AND w.user_id = v_uid`.
    -- The creator disjunct stands alone so a creator whose workspace is
    -- archived keeps autosaving; the resolver disjunct excludes platform
    -- admins, because this function is granted to `authenticated` and is
    -- therefore a client write path that no admin should reach without going
    -- through the app. `IS NOT TRUE` rather than `NOT`, so the disjunct cannot
    -- go dark on the service-role path where auth.uid() is NULL.
    SELECT * INTO v_row
      FROM public.workflows w
     WHERE w.id = p_workflow_id
       AND (w.user_id = v_uid
            OR (is_admin() IS NOT TRUE AND workflow_access(w.id, v_uid) IN ('own', 'edit')))
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::integer, NULL::timestamptz;
        RETURN;
    END IF;

    IF v_row.version <> p_base_version THEN
        RETURN QUERY SELECT false, v_row.version, v_row.updated_at;
        RETURN;
    END IF;

    SELECT coalesce(array_agg(e->>'id'), '{}'::text[]) INTO v_upsert_node_ids
      FROM jsonb_array_elements(p_upsert_nodes) e;
    SELECT coalesce(array_agg(e->>'id'), '{}'::text[]) INTO v_upsert_edge_ids
      FROM jsonb_array_elements(p_upsert_edges) e;

    -- Existing nodes: drop deletions, replace upserted ids in place.
    SELECT coalesce(jsonb_agg(
             CASE WHEN (t.elem->>'id') = ANY(v_upsert_node_ids)
                  THEN (SELECT u FROM jsonb_array_elements(p_upsert_nodes) u
                         WHERE u->>'id' = t.elem->>'id' LIMIT 1)
                  ELSE t.elem END
             ORDER BY t.ord), '[]'::jsonb)
      INTO v_nodes
      FROM jsonb_array_elements(v_row.nodes) WITH ORDINALITY AS t(elem, ord)
     WHERE NOT ((t.elem->>'id') = ANY(p_delete_node_ids));

    -- Genuinely new node ids append at the end, preserving delta order
    -- (client sends new group parents before their children).
    v_nodes := v_nodes || coalesce((
        SELECT jsonb_agg(s.u ORDER BY s.ord)
          FROM jsonb_array_elements(p_upsert_nodes) WITH ORDINALITY AS s(u, ord)
         WHERE NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_row.nodes) e
              WHERE e->>'id' = s.u->>'id')
    ), '[]'::jsonb);

    SELECT coalesce(jsonb_agg(
             CASE WHEN (t.elem->>'id') = ANY(v_upsert_edge_ids)
                  THEN (SELECT u FROM jsonb_array_elements(p_upsert_edges) u
                         WHERE u->>'id' = t.elem->>'id' LIMIT 1)
                  ELSE t.elem END
             ORDER BY t.ord), '[]'::jsonb)
      INTO v_edges
      FROM jsonb_array_elements(v_row.edges) WITH ORDINALITY AS t(elem, ord)
     WHERE NOT ((t.elem->>'id') = ANY(p_delete_edge_ids));

    v_edges := v_edges || coalesce((
        SELECT jsonb_agg(s.u ORDER BY s.ord)
          FROM jsonb_array_elements(p_upsert_edges) WITH ORDINALITY AS s(u, ord)
         WHERE NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_row.edges) e
              WHERE e->>'id' = s.u->>'id')
    ), '[]'::jsonb);

    v_name := coalesce(p_set->>'name', v_row.name);
    v_settings := v_row.settings;
    IF p_set IS NOT NULL AND p_set ? 'settings' THEN
        -- Shallow per-key replace (NOT deep merge): each provided settings
        -- key overwrites the stored key wholesale.
        v_settings := v_settings || (p_set->'settings');
    END IF;

    UPDATE public.workflows w
       SET nodes = v_nodes,
           edges = v_edges,
           name = v_name,
           settings = v_settings
     WHERE w.id = p_workflow_id;

    RETURN QUERY
        SELECT true, w.version, w.updated_at
          FROM public.workflows w
         WHERE w.id = p_workflow_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- The policies. Every one of the eleven originals is dropped by its exact
-- catalog name first — leaving one in place would OR its permissions back in,
-- and in the UPDATE case the old policy's implicit WITH CHECK would void the
-- column pinning above entirely.
-- ---------------------------------------------------------------------------

-- ---- workflows ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own workflows"   ON workflows;
DROP POLICY IF EXISTS "Users can insert own workflows" ON workflows;
DROP POLICY IF EXISTS "Users can update own workflows" ON workflows;
DROP POLICY IF EXISTS "Users can delete own workflows" ON workflows;

DROP POLICY IF EXISTS workflows_select ON workflows;
CREATE POLICY workflows_select ON workflows FOR SELECT USING (
  (select auth.uid()) = user_id OR is_admin() OR workflow_access(id) <> 'none');

DROP POLICY IF EXISTS workflows_insert ON workflows;
CREATE POLICY workflows_insert ON workflows FOR INSERT WITH CHECK (
  (select auth.uid()) = user_id
  AND (workspace_id IS NULL OR workspace_role(workspace_id) IS NOT NULL));

-- The creator disjunct stands alone; the resolver disjunct excludes platform
-- admins. An admin edits through the app, on the service role, where it is
-- recorded who acted — never from a browser. `is_admin()` is EXISTS-based and
-- traps its own exceptions, so it returns false and never NULL (019:60).
--
-- The creator disjunct also deliberately bypasses the archived-workspace view
-- cap on this client path: archived-means-read-only is enforced by the access
-- resolver and by the routes. A creator whose workspace is archived can still
-- write directly. That is a known, accepted difference between this policy and
-- workflow_access(), not a parity failure — the parity job compares the
-- FUNCTION to its twin, and its row-set assertions are SELECT-only.
DROP POLICY IF EXISTS workflows_update ON workflows;
CREATE POLICY workflows_update ON workflows FOR UPDATE
  USING ((select auth.uid()) = user_id
         OR (is_admin() IS NOT TRUE AND workflow_access(id) IN ('own','edit')))
  WITH CHECK (check_workflows_update_allowed(
    id, user_id, created_by, original_author_id, source_kind, source_id, assignment_id,
    visibility, project_id, share_token, is_presentation_enabled));

-- DELETE is creator-only on the client path: a workspace admin deletes a
-- member's work through the app, where the deletion is attributable, never
-- from a browser. The resolver disjunct is dropped rather than guarded because
-- it could only ever be true for the creator or a platform admin — every grant
-- and every derived level is capped at 'edit' (GRANTED_ACCESS is view|edit),
-- so "creator only" IS the guarded form, spelled without the dead branch.
DROP POLICY IF EXISTS workflows_delete ON workflows;
CREATE POLICY workflows_delete ON workflows FOR DELETE USING ((select auth.uid()) = user_id);

-- ---- projects -------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own projects"   ON projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON projects;
DROP POLICY IF EXISTS "Users can update own projects" ON projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON projects;

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT USING (
  (select auth.uid()) = user_id OR is_admin()
  OR (workspace_id IS NOT NULL AND workspace_role(workspace_id) IS NOT NULL));

DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (
  (select auth.uid()) = user_id
  AND (workspace_id IS NULL OR ws_setting_bool(workspace_id, 'members_can_create_projects')
       OR workspace_role(workspace_id) = 'admin'));

DROP POLICY IF EXISTS projects_update ON projects;
CREATE POLICY projects_update ON projects FOR UPDATE
  USING ((select auth.uid()) = user_id
         OR (workspace_id IS NOT NULL AND workspace_role(workspace_id) = 'admin'))
  WITH CHECK (check_projects_update_allowed(id, user_id, workspace_id, is_default));

DROP POLICY IF EXISTS projects_delete ON projects;
CREATE POLICY projects_delete ON projects FOR DELETE USING ((select auth.uid()) = user_id);

-- ---- locations / objects / creatures ---------------------------------------
-- Today's rule stays FIRST, and it is not decoration: project_id is NULLABLE on
-- all three, and a predicate that reached the row only through its project
-- would make every project-less row invisible to the person who created it.
--
-- The added path is the WORKSPACE one only. An earlier draft also let the
-- PROJECT'S OWNER see rows other people put in their project; that is dropped
-- here deliberately. In a workspace it is redundant (the owner is a member and
-- already sees them through the workspace disjunct), and outside one it would
-- widen who can see personal content as a side effect of a scoping migration.
-- Production has zero rows of that shape and the INSERT check below makes more
-- of them unreachable, so the disjunct could only ever have widened, never
-- helped.
--
-- INSERT and UPDATE gain the check `characters` has had since 032: you may
-- attach a row only to a project you own.
DROP POLICY IF EXISTS "Users can CRUD own locations" ON locations;
DROP POLICY IF EXISTS locations_select ON locations;
CREATE POLICY locations_select ON locations FOR SELECT USING (
  (select auth.uid()) = user_id OR is_admin()
  OR EXISTS (SELECT 1 FROM projects p WHERE p.id = locations.project_id
             AND p.workspace_id IS NOT NULL AND workspace_role(p.workspace_id) IS NOT NULL));
DROP POLICY IF EXISTS locations_insert ON locations;
CREATE POLICY locations_insert ON locations FOR INSERT WITH CHECK (
  (select auth.uid()) = user_id
  AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = (select auth.uid()))));
DROP POLICY IF EXISTS locations_update ON locations;
CREATE POLICY locations_update ON locations FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id
  AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = (select auth.uid()))));
DROP POLICY IF EXISTS locations_delete ON locations;
CREATE POLICY locations_delete ON locations FOR DELETE USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can CRUD own objects" ON objects;
DROP POLICY IF EXISTS objects_select ON objects;
CREATE POLICY objects_select ON objects FOR SELECT USING (
  (select auth.uid()) = user_id OR is_admin()
  OR EXISTS (SELECT 1 FROM projects p WHERE p.id = objects.project_id
             AND p.workspace_id IS NOT NULL AND workspace_role(p.workspace_id) IS NOT NULL));
DROP POLICY IF EXISTS objects_insert ON objects;
CREATE POLICY objects_insert ON objects FOR INSERT WITH CHECK (
  (select auth.uid()) = user_id
  AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = (select auth.uid()))));
DROP POLICY IF EXISTS objects_update ON objects;
CREATE POLICY objects_update ON objects FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id
  AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = (select auth.uid()))));
DROP POLICY IF EXISTS objects_delete ON objects;
CREATE POLICY objects_delete ON objects FOR DELETE USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can CRUD own creatures" ON creatures;
DROP POLICY IF EXISTS creatures_select ON creatures;
CREATE POLICY creatures_select ON creatures FOR SELECT USING (
  (select auth.uid()) = user_id OR is_admin()
  OR EXISTS (SELECT 1 FROM projects p WHERE p.id = creatures.project_id
             AND p.workspace_id IS NOT NULL AND workspace_role(p.workspace_id) IS NOT NULL));
DROP POLICY IF EXISTS creatures_insert ON creatures;
CREATE POLICY creatures_insert ON creatures FOR INSERT WITH CHECK (
  (select auth.uid()) = user_id
  AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = (select auth.uid()))));
DROP POLICY IF EXISTS creatures_update ON creatures;
CREATE POLICY creatures_update ON creatures FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id
  AND (project_id IS NULL OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.user_id = (select auth.uid()))));
DROP POLICY IF EXISTS creatures_delete ON creatures;
CREATE POLICY creatures_delete ON creatures FOR DELETE USING ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Grants. Supabase grants `anon` explicitly, so REVOKE FROM PUBLIC alone would
-- leave an anonymous caller able to probe these.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.access_rank(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.access_rank(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.access_rank(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.workflow_access(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.workflow_access(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.workflow_access(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_workflows_update_allowed(uuid, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_workflows_update_allowed(uuid, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_workflows_update_allowed(uuid, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_projects_update_allowed(uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_projects_update_allowed(uuid, uuid, uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_projects_update_allowed(uuid, uuid, uuid, boolean) TO authenticated;

-- 219's grants, restated in the one-role-per-line shape the grants guard
-- asserts. service_role has its own line because the backend calls this RPC
-- with the service client; the split changes nothing about who may execute.
REVOKE EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) TO service_role;
