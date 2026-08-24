-- Workflow cover placeholder: what is IN the flow, cheap enough to list.
--
-- A workflow card with no chosen cover used to render a flat grey box. It now
-- renders a designed placeholder whose look is derived from what the flow
-- makes — video, image, audio, text — so a wall of cover-less cards still tells
-- you which one is the video flow.
--
-- The dashboard lists up to 200 workflows with a narrow column set; selecting
-- `nodes` for that is hundreds of KB of JSON to answer a question about a
-- handful of strings. This column carries just the distinct node types.
--
-- It is maintained by a TRIGGER, not by the callers. There are several paths
-- that write a graph — the editor's full save, the delta RPC
-- (`apply_workflow_delta`), the MCP `update_workflow_json`, import, and the
-- Workflow Copilot's `edit_workflow` — and a column each of them has to
-- remember to set is a column that goes stale. The trigger is the single
-- source of truth, and a path added tomorrow is correct for free.
--
-- No type-to-medium mapping lives here on purpose: that classification is
-- `getOutputType` in `@nodaro/shared`, and duplicating it in SQL would be a
-- second list to keep in sync. SQL reports the raw types; the client decides
-- what they mean.

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS cover_node_types text[];

COMMENT ON COLUMN public.workflows.cover_node_types IS
  'Distinct node types in `nodes`, maintained by trigger. Feeds the dashboard cover placeholder. NULL = never written; {} = a flow with no nodes.';

CREATE OR REPLACE FUNCTION public.workflows_set_cover_node_types()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(NEW.nodes) <> 'array' THEN
    NEW.cover_node_types := '{}';
    RETURN NEW;
  END IF;

  -- No LIMIT: a bound here would have to sit before the filter, and then a
  -- node past the cutoff is silently dropped and its flow shows the wrong
  -- cover. `edit_workflow` already caps a graph at 250 nodes
  -- (`GRAPH_CAPS.maxNodes`), and scanning that is microseconds — the cost this
  -- was guarding against is not real, while the truncation was.
  SELECT COALESCE(array_agg(DISTINCT node_type), '{}')
    INTO NEW.cover_node_types
    FROM jsonb_array_elements(NEW.nodes) AS element
    CROSS JOIN LATERAL (SELECT element ->> 'type' AS node_type) AS t
   WHERE node_type IS NOT NULL AND node_type <> '';

  RETURN NEW;
END;
$$;

-- Listing `cover_node_types` as well as `nodes` is what makes this an
-- invariant rather than a convention: RLS lets an owner PATCH the column
-- directly through PostgREST, and without this the hand-written value would
-- stick. Firing on it recomputes from `NEW.nodes` and overwrites the attempt.
-- The hot path is unaffected — an autosave that moves the viewport, or a
-- thumbnail write, touches neither column and does not re-scan the graph.
DROP TRIGGER IF EXISTS workflows_cover_node_types ON public.workflows;
CREATE TRIGGER workflows_cover_node_types
  BEFORE INSERT OR UPDATE OF nodes, cover_node_types ON public.workflows
  FOR EACH ROW
  EXECUTE FUNCTION public.workflows_set_cover_node_types();

-- Belt and braces: nothing outside the trigger has a reason to write it.
REVOKE UPDATE (cover_node_types) ON public.workflows FROM authenticated, anon;

-- Backfill.
--
-- `set_updated_at` (migration 001) sets `NEW.updated_at = NOW()` on EVERY
-- update, unconditionally. Backfilling with it live would stamp every workflow
-- with the deploy time — and the dashboard sorts by `updated_at DESC`, so every
-- user's cards would silently reshuffle into deploy order. Disabling it for the
-- duration is the only way to touch these rows without lying about when they
-- last changed.
--
-- One statement rather than a batched loop on purpose: the ADD COLUMN above
-- already took ACCESS EXCLUSIVE on this table and holds it to COMMIT, so
-- batching would extend the blocked window instead of shortening it.
-- (DISABLE TRIGGER itself only takes SHARE ROW EXCLUSIVE; the ALTER is what
-- blocks readers.) Measured at ~50ms against a production-shaped table.
ALTER TABLE public.workflows DISABLE TRIGGER set_updated_at;

UPDATE public.workflows w
   SET cover_node_types = COALESCE((
         SELECT array_agg(DISTINCT node_type)
           FROM (
             SELECT element ->> 'type' AS node_type
               FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(w.nodes) = 'array' THEN w.nodes ELSE '[]'::jsonb END
                    ) AS element
              LIMIT 500
           ) AS types
          WHERE node_type IS NOT NULL AND node_type <> ''
       ), '{}')
 WHERE cover_node_types IS NULL;

ALTER TABLE public.workflows ENABLE TRIGGER set_updated_at;
