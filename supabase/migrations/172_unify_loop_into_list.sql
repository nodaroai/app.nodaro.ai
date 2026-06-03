-- 172: Unify the legacy `loop` ("Table") node type into the canonical `list` type.
--
-- Rewrites node.type === "loop" -> "list" inside EVERY stored node-array JSONB
-- column:
--   1. workflows.nodes            (the editable workflow — editor load-migration)
--   2. published_apps.snapshot_nodes (immutable app/component snapshots, incl. all
--      versions: each version is a separate published_apps row, UNIQUE(workflow_id,
--      version); components share this table via publish_type)
--   3. workflow_templates.snapshot_nodes (discoverable/cloneable template snapshots)
-- Edges are untouched (list/loop share handle ids). Idempotent: only rows that
-- still contain a "loop" node are updated; re-running is a no-op. Pairs with the
-- frontend load-migrations (useWorkflowStore.loadWorkflow, usePresentationStore,
-- useAppRunnerStore) + backend orchestrator normalization (loop -> list, see
-- backend/src/services/workflow-engine/normalize-node-types.ts).
--
-- jsonb_agg NULL footgun: jsonb_agg over ZERO input rows returns SQL NULL, which
-- would corrupt a row's array column to NULL. Each WHERE predicate
-- (<col> @> '[{"type":"loop"}]') guarantees we only touch rows whose array is
-- non-empty AND contains a loop node, so jsonb_array_elements yields >=1 row and
-- jsonb_agg is never NULL. The predicate is load-bearing — keep it.

UPDATE public.workflows w
SET nodes = (
  SELECT jsonb_agg(
    CASE WHEN node->>'type' = 'loop'
         THEN jsonb_set(node, '{type}', '"list"'::jsonb)
         ELSE node
    END
  )
  FROM jsonb_array_elements(w.nodes) AS node
)
WHERE w.nodes @> '[{"type": "loop"}]'::jsonb;

UPDATE public.published_apps a
SET snapshot_nodes = (
  SELECT jsonb_agg(
    CASE WHEN node->>'type' = 'loop'
         THEN jsonb_set(node, '{type}', '"list"'::jsonb)
         ELSE node
    END
  )
  FROM jsonb_array_elements(a.snapshot_nodes) AS node
)
WHERE a.snapshot_nodes @> '[{"type": "loop"}]'::jsonb;

UPDATE public.workflow_templates t
SET snapshot_nodes = (
  SELECT jsonb_agg(
    CASE WHEN node->>'type' = 'loop'
         THEN jsonb_set(node, '{type}', '"list"'::jsonb)
         ELSE node
    END
  )
  FROM jsonb_array_elements(t.snapshot_nodes) AS node
)
WHERE t.snapshot_nodes @> '[{"type": "loop"}]'::jsonb;
