-- Selector inline node (node-executor.ts INLINE_NODES) — pure in-process
-- logic, no provider cost (0cr). Mirrors STATIC_CREDIT_COSTS in
-- backend/src/ee/billing/credits.ts:522 ("selector": 0).
--
-- Without this row, the 2026-05 hard-fail pricing policy
-- (getModelCreditBaseCost) throws PriceNotConfiguredError on the model_pricing
-- lookup, and the admin Models UI hides the node from its pricing table.
-- Peer list-shaping nodes were seeded in migration 159_inline_node_zero_pricing.

INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('selector', 0, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
