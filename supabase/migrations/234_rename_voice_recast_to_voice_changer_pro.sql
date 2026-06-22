-- Rename the node type-id `voice-recast` → `voice-changer-pro` across existing DB
-- rows. The identifier was renamed in code (route, engine, registries, SDK, MCP);
-- this converts the handful of pre-rename test jobs + the pricing row so NOTHING
-- references the old id anymore. Idempotent (all guarded by the old value).

-- Pricing row (admin /models reads model_pricing; static fallback already renamed).
-- UPDATE first (renames the existing row on prod, which migration 233 seeded as
-- 'voice-recast'), THEN INSERT the canonical seed ON CONFLICT DO NOTHING. Order
-- matters: inserting first would collide with the UPDATE on the unique
-- model_identifier. The INSERT covers a hypothetical fresh DB where the old row
-- was already gone, and is the canonical seed the credit-pricing-sync guard wants.
UPDATE model_pricing
   SET model_identifier = 'voice-changer-pro'
 WHERE model_identifier = 'voice-recast';

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category)
VALUES ('voice-changer-pro', 4, true, 'audio')
ON CONFLICT (model_identifier) DO NOTHING;

-- Jobs: the job_type column + the input_data.type jsonb field.
UPDATE jobs
   SET job_type = 'voice-changer-pro'
 WHERE job_type = 'voice-recast';

UPDATE jobs
   SET input_data = jsonb_set(input_data, '{type}', '"voice-changer-pro"'::jsonb, false)
 WHERE input_data ->> 'type' = 'voice-recast';

-- usage_logs.model_identifier (credit ledger) — guarded: only if the column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage_logs' AND column_name = 'model_identifier'
  ) THEN
    UPDATE usage_logs
       SET model_identifier = 'voice-changer-pro'
     WHERE model_identifier = 'voice-recast';
  END IF;
END $$;

-- Saved workflows: convert any node whose type-id is voice-recast inside the
-- nodes jsonb. Blanket text replace is safe — `voice-recast` only appears as the
-- node type-id in node data. Guarded so it no-ops if the table/column is absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workflows' AND column_name = 'nodes'
  ) THEN
    UPDATE workflows
       SET nodes = REPLACE(nodes::text, 'voice-recast', 'voice-changer-pro')::jsonb
     WHERE nodes::text LIKE '%voice-recast%';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workflow_versions' AND column_name = 'nodes'
  ) THEN
    UPDATE workflow_versions
       SET nodes = REPLACE(nodes::text, 'voice-recast', 'voice-changer-pro')::jsonb
     WHERE nodes::text LIKE '%voice-recast%';
  END IF;
END $$;
