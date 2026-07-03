-- Delta-save protocol (P3).
--
-- apply_workflow_delta applies an id-keyed node/edge delta atomically against
-- an exact base version: FOR UPDATE row lock, integer CAS, whole-node
-- replace-in-place (array order preserved — render/parent ordering is
-- positional), genuinely-new ids appended in the delta's order, shallow
-- per-key settings replace. The migration-218 trigger bumps `version` and
-- set_updated_at bumps `updated_at` — this function adds NO second
-- bookkeeping path.
--
-- Ownership: auth.uid() when present (authenticated PostgREST callers can
-- NEVER act as someone else — p_user_id is ignored for them); p_user_id is
-- honored only under the service role (auth.uid() IS NULL), for the REST
-- route which authenticates the user itself.
--
-- Returns (ok, version, updated_at):
--   ok=true             → applied; version/updated_at are the NEW tokens.
--   ok=false, version≠Ø → CAS conflict; version/updated_at are the CURRENT row tokens.
--   ok=false, version=Ø → row not found / not owned.

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

REVOKE ALL ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) TO authenticated, service_role;
