-- 195_pipeline_entity_fk_indexes.sql
--
-- Add the missing indexes on three foreign-key columns introduced in migration
-- 121 (pipelines). Migration 121 indexed the pipeline_id / node_id / stage_id
-- FKs but left these three unindexed:
--
--   * pipeline_entity_variants.entity_id  → pipeline_entities(id) ON DELETE CASCADE
--   * pipeline_entity_nodes.entity_id     → pipeline_entities(id) ON DELETE CASCADE
--   * assets.pipeline_entity_id           → pipeline_entities(id) ON DELETE SET NULL
--
-- Why it matters (same rationale as migration 052_unindexed_foreign_keys):
--   1. Every DELETE on a pipeline_entities row forces a sequential scan of each
--      child table to honor the CASCADE / SET NULL referential action.
--   2. The RLS policies on the two child tables filter via
--      `EXISTS (... WHERE pe.id = <child>.entity_id ...)` — an unindexed join.
--   `assets` is one of the highest-row tables in the schema, so its missing
--   index is the most impactful.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS pipeline_entity_variants_entity_idx
  ON pipeline_entity_variants (entity_id);

CREATE INDEX IF NOT EXISTS pipeline_entity_nodes_entity_idx
  ON pipeline_entity_nodes (entity_id);

CREATE INDEX IF NOT EXISTS assets_pipeline_entity_idx
  ON assets (pipeline_entity_id)
  WHERE pipeline_entity_id IS NOT NULL;
