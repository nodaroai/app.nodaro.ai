-- Renames the fan-in reducer node from "collect" to "reduce" across the database.
-- Companion to the source-code rename landing in the same PR.
--
-- Background: the existing "Collect" node is a fan-in reducer (Pick best LLM,
-- Concat, First-non-empty, Count, Vote, Merge JSON). Its name is semantically
-- mismatched with its function. Renaming to "Reduce" both fits better AND
-- frees the "Collect" name for a true type-bucketing aggregator landing in a
-- parallel PR.

-- 1. Rename credit-pricing keys (model_pricing table). UPDATE keeps history
--    intact rather than INSERT-then-DELETE which would lose past usage_logs
--    correlations via model_identifier.
UPDATE model_pricing
SET model_identifier = REPLACE(model_identifier, 'collect:', 'reduce:')
WHERE model_identifier LIKE 'collect:%';

-- 1b. Insert the reduce:* rows for fresh installs / branches where the
--     collect:* rows from migration 149 never existed. The
--     credit-pricing-migration-sync test asserts every STATIC_CREDIT_COSTS
--     key in `backend/src/ee/billing/credits.ts` is inserted by SOME
--     migration, so the rename PR has to carry an explicit INSERT here.
--     `ON CONFLICT DO NOTHING` is the standard idempotency guard.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES
  ('reduce:pick-best-llm', 3, true, 'utility'),
  ('reduce:concat', 0, true, 'utility'),
  ('reduce:first-non-empty', 0, true, 'utility'),
  ('reduce:count', 0, true, 'utility'),
  ('reduce:vote', 0, true, 'utility'),
  ('reduce:merge-json', 0, true, 'utility')
ON CONFLICT (model_identifier) DO NOTHING;

-- 2. Rewrite saved workflow JSON: nodes[].type "collect" → "reduce"
--    (JSONB path update across the workflows.data column). Only touches
--    workflows that contain at least one collect node.
UPDATE workflows
SET data = jsonb_set(
  data,
  '{nodes}',
  (
    SELECT jsonb_agg(
      CASE WHEN node->>'type' = 'collect'
        THEN jsonb_set(node, '{type}', '"reduce"')
        ELSE node
      END
    )
    FROM jsonb_array_elements(data->'nodes') AS node
  )
)
WHERE data->'nodes' @> '[{"type": "collect"}]'::jsonb;

-- Rollback (apply with caution — only if the source-code rename is also reverted):
-- UPDATE model_pricing SET model_identifier = REPLACE(model_identifier, 'reduce:', 'collect:') WHERE model_identifier LIKE 'reduce:%';
-- UPDATE workflows
-- SET data = jsonb_set(data, '{nodes}', (
--   SELECT jsonb_agg(
--     CASE WHEN node->>'type' = 'reduce'
--       THEN jsonb_set(node, '{type}', '"collect"')
--       ELSE node
--     END
--   )
--   FROM jsonb_array_elements(data->'nodes') AS node
-- ))
-- WHERE data->'nodes' @> '[{"type": "reduce"}]'::jsonb;
