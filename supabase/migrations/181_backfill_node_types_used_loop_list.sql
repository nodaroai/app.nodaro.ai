-- 181: Backfill workflow_templates.node_types_used — loop -> list.
--
-- Migration 172 rewrote node.type loop->list inside the snapshot_nodes JSON but
-- left the denormalized, GIN-indexed node_types_used facet untouched. That facet
-- drives template node-type filtering (routes/workflow-templates.ts:
-- query.contains("node_types_used", [nodeType])), so a template published with a
-- loop node became mis-faceted: invisible under a "list" filter, only matchable
-- under the now-retired "loop" filter. Re-derive the facet for affected rows.
--
-- array_replace maps every 'loop' element to 'list'; the DISTINCT re-aggregation
-- collapses the duplicate that arises when a template already contained BOTH a
-- list AND a loop node (-> two 'list'). Idempotent: the WHERE guard makes a
-- re-run a no-op and only touches rows that still carry 'loop'.
--
-- Going forward, extractNodeTypes() normalizes via normalize-node-types.ts (the
-- single source of truth), so the write path can no longer reintroduce a retired
-- type — guarded by the facet-drift test in workflow-templates.test.ts. This
-- migration only repairs rows written before that fix.
--
-- (workflow_templates is the only table with this facet; tutorials read it from
-- here, and published_apps has no node_types_used column.)

UPDATE public.workflow_templates
SET node_types_used = (
  SELECT array_agg(DISTINCT t ORDER BY t)
  FROM unnest(array_replace(node_types_used, 'loop', 'list')) AS t
)
WHERE 'loop' = ANY(node_types_used);
