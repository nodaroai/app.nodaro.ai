-- Inline / control nodes (node-executor.ts INLINE_NODES) — pure in-process
-- logic, no provider cost (0cr). The 2026-05 hard-fail pricing policy
-- (getModelCreditBaseCost) throws PriceNotConfiguredError on ANY unconfigured
-- identifier; a pipeline path that prices these by their bare node type then
-- stalls with no error (prod 2026-05-27: shot-list scene generation hit bare
-- "split-text" → pipeline e06d9ff3 stuck at status=running).
--
-- Mirrors STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts. The
-- composite / router / sub-workflow / save-to-storage / component inline nodes
-- were already seeded (migrations 059, 092); this fills the remaining gaps.
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('combine-text',      0, true, 'other'),
  ('split-text',        0, true, 'other'),
  ('extract-field',     0, true, 'other'),
  ('json-process',      0, true, 'other'),
  ('filter-list',       0, true, 'other'),
  ('deduplicate',       0, true, 'other'),
  ('merge-lists',       0, true, 'other'),
  ('sort-list',         0, true, 'other'),
  ('webhook-output',    0, true, 'other'),
  ('preview',           0, true, 'other'),
  ('teleport-send',     0, true, 'other'),
  ('teleport-receive',  0, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
