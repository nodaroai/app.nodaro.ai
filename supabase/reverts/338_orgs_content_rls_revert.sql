-- ============================================================================
-- REVERT for 338_orgs_content_rls.sql — restores the pre-organizations rules.
--
-- This file lives OUTSIDE every glob that applies migrations (run-migrations,
-- the CI idempotency step, config.toml, `supabase db push` all read
-- supabase/migrations/ only). Nothing runs it automatically; it exists so that
-- if 338 misbehaves on production, the way back is a reviewed file and not
-- SQL composed under pressure at 2am.
--
-- The recreated policies are copied VERBATIM from their sources —
-- 032_consolidate_rls_and_indexes.sql (workflows, projects, locations,
-- objects) and 206_creatures.sql (creatures) — not reconstructed from memory.
--
-- Order matters: new policies dropped first, originals recreated second,
-- apply_workflow_delta restored third, and only then the functions dropped —
-- dependents before dependencies, and no window in which a table has no
-- policy while its RLS is enabled (a policyless RLS table denies everyone).
-- Wrap in a transaction when applying: BEGIN; \i thisfile; COMMIT;
-- ============================================================================

-- 1. Drop the twenty new policies.
DROP POLICY IF EXISTS workflows_select ON workflows;
DROP POLICY IF EXISTS workflows_insert ON workflows;
DROP POLICY IF EXISTS workflows_update ON workflows;
DROP POLICY IF EXISTS workflows_delete ON workflows;
DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;
DROP POLICY IF EXISTS locations_select ON locations;
DROP POLICY IF EXISTS locations_insert ON locations;
DROP POLICY IF EXISTS locations_update ON locations;
DROP POLICY IF EXISTS locations_delete ON locations;
DROP POLICY IF EXISTS objects_select ON objects;
DROP POLICY IF EXISTS objects_insert ON objects;
DROP POLICY IF EXISTS objects_update ON objects;
DROP POLICY IF EXISTS objects_delete ON objects;
DROP POLICY IF EXISTS creatures_select ON creatures;
DROP POLICY IF EXISTS creatures_insert ON creatures;
DROP POLICY IF EXISTS creatures_update ON creatures;
DROP POLICY IF EXISTS creatures_delete ON creatures;

-- 2. Recreate the eleven originals, verbatim.

-- 032_consolidate_rls_and_indexes.sql — workflows
CREATE POLICY "Users can view own workflows" ON workflows
  FOR SELECT USING ((select auth.uid()) = user_id OR is_admin());
CREATE POLICY "Users can insert own workflows" ON workflows
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users can update own workflows" ON workflows
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "Users can delete own workflows" ON workflows
  FOR DELETE USING ((select auth.uid()) = user_id);

-- 032 — projects
CREATE POLICY "Users can view own projects" ON projects
  FOR SELECT USING ((select auth.uid()) = user_id OR is_admin());
CREATE POLICY "Users can insert own projects" ON projects
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "Users can update own projects" ON projects
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "Users can delete own projects" ON projects
  FOR DELETE USING ((select auth.uid()) = user_id);

-- 032 — locations, objects
CREATE POLICY "Users can CRUD own locations" ON locations
  FOR ALL USING ((select auth.uid()) = user_id);
CREATE POLICY "Users can CRUD own objects" ON objects
  FOR ALL USING ((select auth.uid()) = user_id);

-- 206_creatures.sql — creatures
CREATE POLICY "Users can CRUD own creatures" ON creatures
  FOR ALL USING ((select auth.uid()) = user_id);

-- 3. apply_workflow_delta back to 219's exact body (creator-only predicate).
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
SET search_path = public
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

    SELECT * INTO v_row
      FROM public.workflows w
     WHERE w.id = p_workflow_id AND w.user_id = v_uid
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

    SELECT coalesce(jsonb_agg(
             CASE WHEN (t.elem->>'id') = ANY(v_upsert_node_ids)
                  THEN (SELECT u FROM jsonb_array_elements(p_upsert_nodes) u
                         WHERE u->>'id' = t.elem->>'id' LIMIT 1)
                  ELSE t.elem END
             ORDER BY t.ord), '[]'::jsonb)
      INTO v_nodes
      FROM jsonb_array_elements(v_row.nodes) WITH ORDINALITY AS t(elem, ord)
     WHERE NOT ((t.elem->>'id') = ANY(p_delete_node_ids));

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

REVOKE ALL ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) TO authenticated, service_role;

-- 4. Drop the new functions — dependents first.
DROP FUNCTION IF EXISTS public.check_workflows_update_allowed(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,boolean);
DROP FUNCTION IF EXISTS public.check_projects_update_allowed(uuid,uuid,uuid,boolean);
DROP FUNCTION IF EXISTS public.workflow_access(uuid, uuid);
DROP FUNCTION IF EXISTS public.access_rank(text);
