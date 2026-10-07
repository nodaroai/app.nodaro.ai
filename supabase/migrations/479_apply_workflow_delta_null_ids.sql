-- apply_workflow_delta: a stored edge or node with no id survives a delete (#1877).
--
-- The function kept an element only when NOT (id = ANY(delete_ids)). For a
-- stored element with no id the comparison is NULL against any non-empty
-- delete list, NOT NULL is NULL, and WHERE drops the row. So a delta that
-- deleted ANY edge silently removed every id-less edge of the workflow. A
-- node delete did the same, because the Copilot deletes a node's edges with
-- it. A NULL inside the delete list did worse: every comparison became NULL,
-- so a delete of {e1, NULL} kept nothing at all. The editor can send that
-- NULL (workflow-delta.ts reads `e.id` from an id-less edge).
--
-- `(id = ANY(delete_ids)) IS NOT TRUE` keeps every element whose id is not
-- definitely in the list.
--
-- That purge also hid a second bug, which this migration closes in the same
-- function. The editor's delta builder keys edges by id, so a graph holding
-- id-less edges re-sends all but one of them on every save. An upserted edge
-- with no id matches no stored edge by id, so each save APPENDED copies, and
-- the next delete purged them. Kept now, they would pile up. So an id-less
-- upserted edge whose connection (source, sourceHandle, target, targetHandle)
-- the graph already holds is a re-send, not a new wire, and is skipped.
--
-- Everything else is 338's body, signature, security and grants, unchanged.
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
     WHERE ((t.elem->>'id') = ANY(p_delete_node_ids)) IS NOT TRUE;

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
     WHERE ((t.elem->>'id') = ANY(p_delete_edge_ids)) IS NOT TRUE;

    v_edges := v_edges || coalesce((
        SELECT jsonb_agg(s.u ORDER BY s.ord)
          FROM jsonb_array_elements(p_upsert_edges) WITH ORDINALITY AS s(u, ord)
         WHERE NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(v_row.edges) e
              WHERE e->>'id' = s.u->>'id')
           -- An id-less upsert of a connection the graph already holds is a
           -- re-send (see the header), not a new wire.
           AND NOT (
               (jsonb_typeof(s.u->'id') IS DISTINCT FROM 'string' OR s.u->>'id' = '')
               AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements(v_edges) e
                    WHERE jsonb_typeof(e) = 'object'
                      AND e->>'source' IS NOT DISTINCT FROM s.u->>'source'
                      AND coalesce(e->>'sourceHandle', '') = coalesce(s.u->>'sourceHandle', '')
                      AND e->>'target' IS NOT DISTINCT FROM s.u->>'target'
                      AND coalesce(e->>'targetHandle', '') = coalesce(s.u->>'targetHandle', '')))
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

REVOKE EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_workflow_delta(uuid, integer, jsonb, text[], jsonb, text[], jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill: every stored edge without an id gets the id the edge normalizer
-- gives one (backend/src/lib/workflow-edge-normalization.ts):
--   e-<source>-<sourceHandle, else "out">-<target>-<targetHandle, else "in">
-- suffixed -2, -3, … until it clashes with no id the graph already has.
--
-- An id-less edge that repeats a connection another edge already makes keeps
-- its place under a suffixed id. Both copies feed the target today, and a
-- migration must not change what a workflow does. The duplicate becomes
-- visible on the canvas instead, where its owner can delete it.
--
-- Skipped: a Studio-owned document (398's guard trigger refuses a generic
-- write to one, and the delta function cannot reach it either).
--
-- `set_updated_at` is off for the update, as in 339, so dashboards do not
-- reshuffle into deploy order. `bump_workflow_version` still fires, so an open
-- editor sees the change.
--
-- Order matters: the rows to fix are locked BEFORE the table lock that
-- DISABLE TRIGGER takes. Otherwise a concurrent delta could hold one of those
-- rows while waiting on the table lock, as the backfill waits on its row: a
-- deadlock, and a failed migrate job.
--
-- Cost: ids in use are kept in a jsonb set and each base remembers its next
-- suffix. So a row with thousands of id-less copies of one connection is
-- linear, not cubic.
--
-- A second run changes nothing (no id-less edge is left), which CI's
-- re-apply needs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r record;
    e jsonb;
    v_taken jsonb;
    v_next jsonb;
    v_out jsonb[];
    v_sh text;
    v_th text;
    v_base text;
    v_id text;
    v_n integer;
BEGIN
    -- 1. Lock the rows to fix (row locks only, which concurrent writers to
    --    OTHER rows never wait on).
    PERFORM 1
       FROM public.workflows w
      WHERE EXISTS (
              SELECT 1
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.edges) = 'array' THEN w.edges ELSE '[]'::jsonb END) x
               WHERE jsonb_typeof(x) = 'object'
                 AND (jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR x->>'id' = ''))
        AND NOT public.workflow_requires_compatible_writer(w.nodes, w.settings)
        FOR UPDATE;

    -- 2. Then the table lock, for the length of this transaction.
    ALTER TABLE public.workflows DISABLE TRIGGER set_updated_at;

    -- 3. The rewrite, on the rows locked above.
    FOR r IN
        SELECT w.id, w.edges
          FROM public.workflows w
         WHERE EXISTS (
                 SELECT 1
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.edges) = 'array' THEN w.edges ELSE '[]'::jsonb END) x
                  WHERE jsonb_typeof(x) = 'object'
                    AND (jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR x->>'id' = ''))
           AND NOT public.workflow_requires_compatible_writer(w.nodes, w.settings)
    LOOP
        SELECT coalesce(jsonb_object_agg(x->>'id', true), '{}'::jsonb)
          INTO v_taken
          FROM jsonb_array_elements(r.edges) x
         WHERE jsonb_typeof(x) = 'object' AND jsonb_typeof(x->'id') = 'string' AND x->>'id' <> '';
        v_next := '{}'::jsonb;
        v_out := ARRAY[]::jsonb[];

        FOR e IN
            SELECT t.x FROM jsonb_array_elements(r.edges) WITH ORDINALITY AS t(x, ord) ORDER BY t.ord
        LOOP
            IF jsonb_typeof(e) = 'object'
               AND (jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR e->>'id' = '') THEN
                v_sh := CASE WHEN jsonb_typeof(e->'sourceHandle') = 'string' AND e->>'sourceHandle' <> ''
                             THEN e->>'sourceHandle' END;
                v_th := CASE WHEN jsonb_typeof(e->'targetHandle') = 'string' AND e->>'targetHandle' <> ''
                             THEN e->>'targetHandle' END;
                v_base := 'e-' || coalesce(e->>'source', '') || '-' || coalesce(v_sh, 'out')
                       || '-' || coalesce(e->>'target', '') || '-' || coalesce(v_th, 'in');
                -- n = 1 is the bare base; every later copy resumes where the last stopped.
                v_n := coalesce((v_next->>v_base)::integer, 1);
                LOOP
                    v_id := CASE WHEN v_n = 1 THEN v_base ELSE v_base || '-' || v_n END;
                    EXIT WHEN NOT (v_taken ? v_id);
                    v_n := v_n + 1;
                END LOOP;
                v_next := v_next || jsonb_build_object(v_base, v_n + 1);
                v_taken := v_taken || jsonb_build_object(v_id, true);
                e := e || jsonb_build_object('id', v_id);
            END IF;
            v_out := array_append(v_out, e);
        END LOOP;

        UPDATE public.workflows SET edges = to_jsonb(v_out) WHERE id = r.id;
    END LOOP;

    ALTER TABLE public.workflows ENABLE TRIGGER set_updated_at;
END
$$;
